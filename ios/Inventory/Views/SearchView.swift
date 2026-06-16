import SwiftUI
import UIKit

private enum SearchMode: String, CaseIterable, Identifiable {
    case qrCode
    case skuCode
    case sn

    var id: String { rawValue }

    var title: String {
        switch self {
        case .qrCode: return "QRC"
        case .skuCode: return "SKU"
        case .sn: return "SN"
        }
    }

    var placeholder: String {
        switch self {
        case .qrCode, .skuCode: return "SKU Code"
        case .sn: return "Serial Number"
        }
    }
}

struct SearchView: View {
    @EnvironmentObject private var appState: AppState
    @State private var mode: SearchMode = .qrCode
    @State private var query = ""
    @State private var foundItem: SKUItem?
    @State private var message: String?
    @State private var lookupTask: Task<Void, Never>?
    @State private var isCameraActive = false
    @State private var pendingAction: SKUAction?
    @State private var pendingActionItem: SKUItem?
    @State private var showingActionScanner = false
    @State private var showingRepairSheet = false
    @State private var repairItemAfterScan: SKUItem?

    private var canTypeSearch: Bool {
        let role = appState.currentUser?.role
        return role == .admin || role == .superadmin
    }

    private var availableModes: [SearchMode] {
        canTypeSearch ? SearchMode.allCases : [.qrCode]
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    GlassPanel {
                        VStack(alignment: .leading, spacing: 14) {
                            if canTypeSearch {
                                Picker("Mode", selection: $mode) {
                                    ForEach(availableModes) { item in
                                        Text(item.title).tag(item)
                                    }
                                }
                                .pickerStyle(.segmented)
                                .frame(maxWidth: .infinity)
                            }

                            if mode == .qrCode {
                                CameraScannerView(isScanning: isCameraActive) { code in
                                    if let normalized = extractSKUCode(from: code) {
                                        query = normalized
                                        lookupTask?.cancel()
                                        Task { await lookup() }
                                    } else {
                                        message = "QR Code does not contain a valid SKU code."
                                    }
                                }
                                .frame(height: 150)
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

                                if !query.isEmpty {
                                    Text("Scanned: \(query)")
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                            }

                            if mode != .qrCode {
                                TextField(mode.placeholder, text: $query)
                                    .textInputAutocapitalization(mode == .skuCode ? .characters : .never)
                                    .autocorrectionDisabled()
                                    .inventorySearchFieldStyle()
                                    .onChange(of: query) { _ in
                                        scheduleLookup()
                                    }
                            }
                        }
                    }

                    if let message {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if let foundItem {
                        GlassPanel {
                            VStack(alignment: .leading, spacing: 16) {
                                SKUCard(item: foundItem)
                                itemContext(for: foundItem)
                                actionButtons(for: foundItem)
                            }
                        }
                    }
                }
                .padding()
            }
            .contentShape(Rectangle())
            .onTapGesture {
                UIApplication.shared.dismissKeyboard()
            }
            .navigationTitle("Search")
            .onAppear { isCameraActive = true }
            .onDisappear {
                isCameraActive = false
                lookupTask?.cancel()
            }
            .sheet(isPresented: $showingActionScanner) {
                if let action = pendingAction, let item = pendingActionItem {
                    InlineActionScanSheet(item: item, action: action) { success in
                        guard success else { return }
                        if action == .repair {
                            repairItemAfterScan = item
                            Task {
                                try? await Task.sleep(nanoseconds: 350_000_000)
                                showingRepairSheet = true
                            }
                        } else {
                            foundItem = appState.skus.first { $0.id == item.id } ?? foundItem
                        }
                    }
                }
            }
            .sheet(isPresented: $showingRepairSheet) {
                if let item = repairItemAfterScan {
                    RepairSheet(sku: item)
                }
            }
            .onChange(of: showingActionScanner) { isShowing in
                if !isShowing { isCameraActive = true }
            }
            .onChange(of: showingRepairSheet) { isShowing in
                if !isShowing, let item = repairItemAfterScan {
                    foundItem = appState.skus.first { $0.id == item.id } ?? foundItem
                }
            }
            .onAppear {
                if !canTypeSearch { mode = .qrCode }
            }
            .onChange(of: mode) { _ in
                query = ""
                foundItem = nil
                message = nil
            }
        }
    }

    @ViewBuilder
    private func itemContext(for item: SKUItem) -> some View {
        switch item.status {
        case .available:
            if let record = appState.records.first(where: { $0.skuId == item.id }) {
                Divider()
                HStack(spacing: 8) {
                    Image(systemName: recordIcon(record.type))
                        .foregroundStyle(recordColor(record.type))
                        .font(.caption)
                    Text(recordLabel(record.type))
                        .font(.caption.weight(.medium))
                    Spacer()
                    if let at = record.createdAt {
                        Text(formatShortDate(at))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        case .borrowed:
            if let name = item.borrowedByName {
                Divider()
                Label("Borrowed by \(name)", systemImage: "person.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .repairing:
            if let name = item.repairRequestedByName {
                Divider()
                Label("Repair requested by \(name)", systemImage: "wrench.and.screwdriver.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private func actionButtons(for item: SKUItem) -> some View {
        let actions = availableActions(for: item)
        if actions.isEmpty {
            Text("No action is available for this status.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        } else {
            VStack(spacing: 10) {
                ForEach(actions) { action in
                    Button {
                        pendingAction = action
                        pendingActionItem = item
                        isCameraActive = false
                        showingActionScanner = true
                    } label: {
                        Text(action.title)
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
    }

    private func availableActions(for item: SKUItem) -> [SKUAction] {
        switch item.status {
        case .available:
            return [.borrow, .repair]
        case .borrowed:
            return [.returnItem]
        case .repairing:
            return [.repaired]
        case .disposed, .sold:
            return []
        }
    }

    private func scheduleLookup() {
        lookupTask?.cancel()
        lookupTask = Task {
            try? await Task.sleep(nanoseconds: 150_000_000)
            guard !Task.isCancelled else { return }
            await lookup()
        }
    }

    @MainActor
    private func lookup() async {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !normalized.isEmpty else {
            foundItem = nil
            message = nil
            return
        }

        if mode == .qrCode || mode == .skuCode {
            guard isValidSKUCode(normalized) else {
                foundItem = nil
                message = nil
                return
            }
            do {
                foundItem = try await appState.lookupSKU(normalized)
                message = nil
            } catch {
                foundItem = nil
                message = error.localizedDescription
            }
        } else {
            foundItem = appState.findBySerial(normalized)
            message = foundItem == nil ? "No equipment found." : nil
        }
    }

    private func isValidSKUCode(_ value: String) -> Bool {
        let pattern = "^[A-Z0-9]+-[A-Z0-9]+-\\d{4}$"
        return value.range(of: pattern, options: .regularExpression) != nil
    }

    private func extractSKUCode(from value: String) -> String? {
        let uppercased = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let pattern = "[A-Z0-9]+-[A-Z0-9]+-\\d{4}"
        guard let range = uppercased.range(of: pattern, options: .regularExpression) else { return nil }
        return String(uppercased[range])
    }

    private func recordLabel(_ type: String) -> String {
        switch type {
        case "borrow": return "Borrowed"
        case "return": return "Returned"
        case "repair": return "Sent for Repair"
        case "repaired": return "Returned from Repair"
        case "transfer": return "Transferred"
        case "sold": return "Sold"
        case "disposal": return "Disposed"
        default: return type.capitalized
        }
    }

    private func recordIcon(_ type: String) -> String {
        switch type {
        case "borrow": return "arrow.up.right.circle.fill"
        case "return": return "arrow.down.left.circle.fill"
        case "repair": return "wrench.and.screwdriver.fill"
        case "repaired": return "checkmark.circle.fill"
        case "transfer": return "arrow.triangle.swap"
        case "sold": return "dollarsign.circle.fill"
        case "disposal": return "xmark.bin.fill"
        default: return "circle.fill"
        }
    }

    private func recordColor(_ type: String) -> Color {
        switch type {
        case "borrow": return .orange
        case "return": return .green
        case "repair": return .red
        case "repaired": return .blue
        case "transfer": return .purple
        default: return .secondary
        }
    }

    private func formatShortDate(_ value: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = f.date(from: value)
        if date == nil {
            f.formatOptions = [.withInternetDateTime]
            date = f.date(from: value)
        }
        guard let date else { return value }
        if Calendar.current.isDateInToday(date) {
            return date.formatted(.dateTime.hour().minute())
        }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
}

private extension View {
    func inventorySearchFieldStyle() -> some View {
        self
            .padding(.horizontal, 14)
            .frame(height: 52)
            .background(Color.secondary.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private extension UIApplication {
    func dismissKeyboard() {
        sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }
}
