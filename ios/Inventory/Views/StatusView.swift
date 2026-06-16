import SwiftUI

struct StatusView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        NavigationStack {
            List {
                let borrowed = appState.borrowedItems
                let repairing = appState.repairingItems
                if borrowed.isEmpty && repairing.isEmpty {
                    EmptyStateView(title: "Now you don't have anything in loan.", systemImage: "checkmark.circle")
                } else {
                    if !borrowed.isEmpty {
                        Section("Borrowed") {
                            ForEach(borrowed) { item in
                                NavigationLink {
                                    StatusDetailView(item: item)
                                } label: {
                                    itemRow(item, dateKey: item.borrowedAt)
                                }
                            }
                        }
                    }
                    if !repairing.isEmpty {
                        Section("In Repair") {
                            ForEach(repairing) { item in
                                NavigationLink {
                                    StatusDetailView(item: item)
                                } label: {
                                    itemRow(item, dateKey: item.repairStartedAt)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Status")
            .refreshable {
                try? await appState.refresh()
            }
        }
    }

    @ViewBuilder
    private func itemRow(_ item: SKUItem, dateKey: String?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SKUCard(item: item)
            if let dateKey {
                HStack {
                    Label(formatTimestamp(dateKey), systemImage: "calendar")
                    Spacer()
                    Text(elapsed(from: dateKey))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
    }

    private func formatTimestamp(_ value: String) -> String {
        guard let date = parseISODate(value) else { return value }
        return date.formatted(
            .dateTime
                .day().month(.abbreviated).year()
                .hour().minute()
                .locale(Locale(identifier: "en_US"))
        )
    }

    private func elapsed(from value: String) -> String {
        guard let date = parseISODate(value) else { return "" }
        let total = Int(Date().timeIntervalSince(date))
        let seconds = total % 60
        let minutes = (total / 60) % 60
        let hours = (total / 3600) % 24
        let days = total / 86400
        if days > 0 { return "\(days)d \(hours)h" }
        if hours > 0 { return "\(hours)h \(minutes)m" }
        if minutes > 0 { return "\(minutes)m \(seconds)s" }
        return "\(max(0, seconds))s"
    }

    private func parseISODate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        return ISO8601DateFormatter().date(from: value)
    }
}

// MARK: - Status Detail

struct StatusDetailView: View {
    @EnvironmentObject private var appState: AppState
    let item: SKUItem

    private var liveItem: SKUItem {
        appState.skus.first { $0.id == item.id } ?? item
    }

    @State private var showingReturnScan = false
    @State private var actionError: String?
    @State private var isActioning = false

    var body: some View {
        List {
            Section {
                SKUCard(item: liveItem)
            }

            Section("Details") {
                if let company = liveItem.companyName, !company.isEmpty {
                    detailRow("Company", value: company)
                }
                if let park = liveItem.parkName, !park.isEmpty {
                    detailRow("Branch", value: park)
                }
                if let cat = liveItem.categoryCode, !cat.isEmpty {
                    detailRow("Category", value: cat)
                }
                if let sn = liveItem.serialNumber, !sn.isEmpty {
                    detailRow("Serial", value: sn)
                }
                if let desc = liveItem.descriptionText, !desc.isEmpty {
                    detailRow("Description", value: desc)
                }
            }

            if liveItem.status == .borrowed, let at = liveItem.borrowedAt {
                Section("Loan") {
                    detailRow("Since", value: formatTimestamp(at))
                    detailRow("Duration", value: elapsed(from: at))
                }
            }

            if liveItem.status == .repairing {
                Section("Repair") {
                    if let name = liveItem.repairRequestedByName {
                        detailRow("Submitted by", value: name)
                    }
                    if let at = liveItem.repairStartedAt {
                        detailRow("Since", value: formatTimestamp(at))
                        detailRow("Duration", value: elapsed(from: at))
                    }
                }
            }

            if let error = actionError {
                Section {
                    Text(error).foregroundStyle(.red).font(.footnote)
                }
            }
        }
        .navigationTitle(liveItem.displayCode)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            returnButton
        }
        .sheet(isPresented: $showingReturnScan) {
            ReturnScanSheet(item: liveItem) { success in
                showingReturnScan = false
                if !success {
                    actionError = "QR code does not match this item."
                }
            }
        }
    }

    @ViewBuilder
    private var returnButton: some View {
        let label: String = liveItem.status == .repairing ? "Return from Repair" : "Return"
        if liveItem.status == .borrowed || liveItem.status == .repairing {
            VStack(spacing: 0) {
                Divider()
                Button {
                    actionError = nil
                    showingReturnScan = true
                } label: {
                    HStack {
                        if isActioning { ProgressView() }
                        Text(label).frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(isActioning)
                .padding()
                .background(.bar)
            }
        }
    }

    private func detailRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).multilineTextAlignment(.trailing)
        }
    }

    private func formatTimestamp(_ value: String) -> String {
        guard let date = parseISODate(value) else { return value }
        return date.formatted(
            .dateTime.day().month(.abbreviated).year().hour().minute()
                .locale(Locale(identifier: "en_US"))
        )
    }

    private func elapsed(from value: String) -> String {
        guard let date = parseISODate(value) else { return "" }
        let total = Int(Date().timeIntervalSince(date))
        let seconds = total % 60
        let minutes = (total / 60) % 60
        let hours = (total / 3600) % 24
        let days = total / 86400
        if days > 0 { return "\(days)d \(hours)h" }
        if hours > 0 { return "\(hours)h \(minutes)m" }
        if minutes > 0 { return "\(minutes)m \(seconds)s" }
        return "\(max(0, seconds))s"
    }

    private func parseISODate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        return ISO8601DateFormatter().date(from: value)
    }
}

// MARK: - Return Scan Sheet

struct ReturnScanSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let item: SKUItem
    let onResult: (Bool) -> Void

    @State private var isActioning = false
    @State private var errorMessage: String?
    @State private var scannedCode: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Scan the QR code on the item to confirm return.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                CameraScannerView(isScanning: scannedCode == nil && !isActioning) { code in
                    guard scannedCode == nil else { return }
                    let extracted = extractSKUCode(from: code)
                    let expected = item.displayCode.uppercased()
                    if extracted == expected {
                        scannedCode = extracted
                        executeReturn()
                    } else {
                        errorMessage = "Scanned code \"\(extracted ?? code)\" does not match \(item.displayCode)."
                    }
                }
                .frame(height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.horizontal)

                if isActioning {
                    ProgressView("Returning…")
                }

                if let msg = errorMessage {
                    Text(msg)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                    Button("Try Again") {
                        errorMessage = nil
                        scannedCode = nil
                    }
                    .buttonStyle(.bordered)
                }

                Spacer()
            }
            .padding(.top)
            .navigationTitle("Scan to Return")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isActioning)
                }
            }
        }
    }

    private func executeReturn() {
        isActioning = true
        errorMessage = nil
        Task {
            defer { isActioning = false }
            do {
                let action: SKUAction = item.status == .repairing ? .repaired : .returnItem
                _ = try await appState.runAction(action, skuCode: item.displayCode)
                dismiss()
                onResult(true)
            } catch {
                errorMessage = error.localizedDescription
                scannedCode = nil
            }
        }
    }

    private func extractSKUCode(from value: String) -> String? {
        let uppercased = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let pattern = "[A-Z0-9]+-[A-Z0-9]+-\\d{4}"
        guard let range = uppercased.range(of: pattern, options: .regularExpression) else { return nil }
        return String(uppercased[range])
    }
}
