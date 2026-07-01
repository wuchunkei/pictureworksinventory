import SwiftUI

// MARK: - Action Scanner Sheet

struct ActionScannerSheet: View {
    let expectedCode: String
    let actionTitle: String
    let onConfirmed: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var isScanning = true
    @State private var showMismatch = false
    @State private var mismatchScale: CGFloat = 0.1

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black

                CameraScannerView(isScanning: isScanning && !showMismatch) { code in
                    handleScan(code)
                }

                VStack {
                    Spacer()
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color.white.opacity(0.75), lineWidth: 2.5)
                        .frame(width: 210, height: 210)
                    Spacer()
                    VStack(spacing: 6) {
                        Text(actionTitle)
                            .font(.headline)
                            .foregroundStyle(.white)
                        Text("Scan \(expectedCode) to confirm")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.75))
                    }
                    .padding(.vertical, 18)
                    .frame(maxWidth: .infinity)
                    .background(.black.opacity(0.5))
                }

                if showMismatch {
                    Color.black.opacity(0.55)
                    VStack(spacing: 18) {
                        ZStack {
                            Circle()
                                .fill(Color.red)
                                .frame(width: 88, height: 88)
                            Image(systemName: "xmark")
                                .font(.system(size: 42, weight: .bold))
                                .foregroundStyle(.white)
                        }
                        .scaleEffect(mismatchScale)
                        .animation(.spring(response: 0.28, dampingFraction: 0.55), value: mismatchScale)
                        Text("SKU Code error")
                            .font(.title3.bold())
                            .foregroundStyle(.white)
                    }
                }
            }
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle(actionTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(.white)
                }
            }
            .toolbarBackground(.black.opacity(0.7), for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private func handleScan(_ raw: String) {
        guard !showMismatch else { return }
        guard let code = extractSKUCode(from: raw) else { return }
        if code.uppercased() == expectedCode.uppercased() {
            isScanning = false
            dismiss()
            onConfirmed()
        } else {
            mismatchScale = 0.1
            showMismatch = true
            withAnimation(.spring(response: 0.28, dampingFraction: 0.55)) {
                mismatchScale = 1.0
            }
            Task {
                try? await Task.sleep(nanoseconds: 2_200_000_000)
                withAnimation(.easeOut(duration: 0.25)) {
                    showMismatch = false
                    mismatchScale = 0.1
                }
            }
        }
    }

    private func extractSKUCode(from value: String) -> String? {
        let up = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let pattern = "[A-Z0-9]+-[A-Z0-9]+-\\d{4}"
        guard let range = up.range(of: pattern, options: .regularExpression) else { return nil }
        return String(up[range])
    }
}

// MARK: - Inline Action Scan Sheet

struct InlineActionScanSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let item: SKUItem
    let action: SKUAction
    let onResult: (Bool) -> Void

    @State private var isActioning = false
    @State private var errorMessage: String?
    @State private var scannedCode: String?

    private var scanTitle: String {
        switch action {
        case .borrow: return "Scan to Borrow"
        case .returnItem: return "Scan to Return"
        case .repair: return "Scan for Repair"
        case .repaired: return "Scan to Return from Repair"
        case .edit: return "Scan to Edit"
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Scan the QR code on the item to confirm.")
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
                        if action == .repair || action == .edit {
                            dismiss()
                            onResult(true)
                        } else {
                            executeAction()
                        }
                    } else {
                        errorMessage = "Scanned code \"\(extracted ?? code)\" does not match \(item.displayCode)."
                    }
                }
                .frame(height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .padding(.horizontal)

                if isActioning {
                    ProgressView("Processing…")
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
            .navigationTitle(scanTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isActioning)
                }
            }
        }
    }

    private func executeAction() {
        isActioning = true
        errorMessage = nil
        Task {
            defer { isActioning = false }
            do {
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
        let up = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let pattern = "[A-Z0-9]+-[A-Z0-9]+-\\d{4}"
        guard let range = up.range(of: pattern, options: .regularExpression) else { return nil }
        return String(up[range])
    }
}

// MARK: - Inventory List

struct InventoryListView: View {
    @EnvironmentObject private var appState: AppState
    @State private var filterStatus: SKUStatus? = nil
    @State private var showingAdd = false
    @State private var showingExport = false
    @State private var showingImport = false
    @State private var searchText = ""

    private var canManage: Bool {
        appState.permissions?.canManageInventory == true
    }

    /// Asset Check Form export is limited to admin / superadmin.
    private var canExport: Bool {
        appState.currentUser?.role == .admin || appState.currentUser?.role == .superadmin
    }

    private var displayedSKUs: [SKUItem] {
        var base = filterStatus == nil ? appState.skus : appState.skus.filter { $0.status == filterStatus }
        if !searchText.isEmpty {
            let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            base = base.filter {
                $0.displayCode.lowercased().contains(q) ||
                ($0.serialNumber?.lowercased().contains(q) == true) ||
                ($0.descriptionText?.lowercased().contains(q) == true)
            }
        }
        return base.sorted { $0.displayCode < $1.displayCode }
    }

    var body: some View {
        List {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    filterChip("All", active: filterStatus == nil) { filterStatus = nil }
                    filterChip("Available", active: filterStatus == .available) { filterStatus = .available }
                    filterChip("Borrowed", active: filterStatus == .borrowed) { filterStatus = .borrowed }
                    filterChip("Repairing", active: filterStatus == .repairing) { filterStatus = .repairing }
                    filterChip("Disposed", active: filterStatus == .disposed) { filterStatus = .disposed }
                }
                .padding(.vertical, 4)
                .padding(.horizontal, 2)
            }
            .listRowInsets(EdgeInsets(top: 2, leading: 8, bottom: 4, trailing: 8))
            .listRowBackground(Color.clear)

            if displayedSKUs.isEmpty {
                EmptyStateView(title: "No items", systemImage: "shippingbox")
            } else {
                ForEach(displayedSKUs) { sku in
                    Section {
                        NavigationLink {
                            SKUDetailView(initialSKU: sku)
                        } label: {
                            skuRow(sku)
                        }
                    }
                }
            }
        }
        .compactListSections()
        .navigationTitle("Inventory")
        .searchable(text: $searchText, prompt: "Search by SKU code or serial")
        .tightSearchTopInset()
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if canManage {
                    Button { showingImport = true } label: {
                        Image(systemName: "square.and.arrow.down")
                    }
                    .disabled(appState.companies.isEmpty)
                }
                if canExport {
                    Button { showingExport = true } label: {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .disabled(appState.companies.isEmpty)
                }
                if canManage {
                    Button { showingAdd = true } label: { Image(systemName: "plus") }
                        .disabled(appState.companies.isEmpty)
                }
            }
        }
        .sheet(isPresented: $showingAdd) {
            AddSKUSheet()
        }
        .sheet(isPresented: $showingImport) {
            ImportACFSheet()
        }
        .sheet(isPresented: $showingExport) {
            ExportACFSheet()
        }
        .refreshable {
            try? await appState.refresh()
        }
    }

    private func skuRow(_ sku: SKUItem) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(sku.displayCode)
                    .font(.headline)
                HStack(spacing: 8) {
                    if let cat = sku.categoryCode, !cat.isEmpty {
                        Text(cat)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let park = sku.parkName, !park.isEmpty {
                        Text(park)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                if sku.status == .borrowed, let borrower = sku.borrowedByName {
                    Text(borrower)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer()
            StatusPill(status: sku.status)
        }
        .padding(.vertical, 4)
    }

    private func filterChip(_ label: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.subheadline.weight(active ? .semibold : .regular))
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(active ? Color.blue : Color(.systemGray5))
                .foregroundStyle(active ? Color.white : Color.primary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - SKU Detail

struct SKUDetailView: View {
    @EnvironmentObject private var appState: AppState
    let initialSKU: SKUItem
    /// When false the view is read-only (no Borrow/Return/Repair/Edit actions) —
    /// used when opening an item from an Asset Check Form.
    var showsActions: Bool = true

    private var sku: SKUItem {
        appState.skus.first { $0.id == initialSKU.id } ?? initialSKU
    }

    @State private var showingRepair = false
    @State private var showingTransfer = false
    @State private var showingDisposal = false
    @State private var showingReturnScan = false
    @State private var actionError: String?
    @State private var showingActionScanner = false
    @State private var showingEditScanner = false
    @State private var showingEdit = false

    private var canManage: Bool {
        appState.permissions?.canManageInventory == true
    }

    private var isSuperadmin: Bool {
        appState.currentUser?.role == .superadmin
    }

    private var canRepair: Bool {
        appState.canRepairInventory
    }

    private var canRequestDisposal: Bool {
        appState.canRequestDisposal
    }

    private var canReturnFromRepair: Bool {
        appState.canReturnFromRepair
    }

    private var recentRecords: [InventoryRecord] {
        guard let cutoff = Calendar.current.date(byAdding: .day, value: -7, to: Date()) else { return [] }
        return appState.records.filter { record in
            record.skuId == sku.id && (parseISODate(record.createdAt ?? "") ?? .distantPast) >= cutoff
        }
    }

    var body: some View {
        List {
            Section { SKUCard(item: sku) }
            detailsSection
            statusSection
            if showsActions {
                actionsSection
                if let actionError {
                    Section {
                        Text(actionError).foregroundStyle(.red).font(.footnote)
                    }
                }
            }
            activitySection
        }
        .navigationTitle(sku.displayCode)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingRepair) { RepairSheet(sku: sku) }
        .sheet(isPresented: $showingTransfer) { TransferSheet(sku: sku) }
        .sheet(isPresented: $showingDisposal) { DisposalSheet(sku: sku) }
        .sheet(isPresented: $showingReturnScan) {
            ReturnScanSheet(item: sku) { success in
                showingReturnScan = false
                if !success {
                    actionError = "QR code does not match this item."
                }
            }
        }
        .sheet(isPresented: $showingActionScanner) {
            InlineActionScanSheet(item: sku, action: .repair) { success in
                guard success else { return }
                Task {
                    try? await Task.sleep(nanoseconds: 350_000_000)
                    showingRepair = true
                }
            }
        }
        .sheet(isPresented: $showingEditScanner) {
            InlineActionScanSheet(item: sku, action: .edit) { success in
                guard success else { return }
                Task {
                    try? await Task.sleep(nanoseconds: 350_000_000)
                    showingEdit = true
                }
            }
        }
        .sheet(isPresented: $showingEdit) {
            EditSKUSheet(sku: sku)
        }
    }

    @ViewBuilder
    private var detailsSection: some View {
        Section("Details") {
            if let company = sku.companyName, !company.isEmpty { detailRow("Company", value: company) }
            if let park = sku.parkName, !park.isEmpty { detailRow("Branch", value: park) }
            if let loc = sku.locationName, !loc.isEmpty { detailRow("Location", value: loc) }
            if let cat = sku.categoryCode, !cat.isEmpty { detailRow("Category", value: cat) }
            if let sn = sku.serialNumber, !sn.isEmpty { detailRow("Serial", value: sn) }
            if let desc = sku.descriptionText, !desc.isEmpty { detailRow("Description", value: desc) }
        }
    }

    @ViewBuilder
    private var statusSection: some View {
        if sku.status == .borrowed {
            Section("Borrower") {
                if let name = sku.borrowedByName { detailRow("Name", value: name) }
                if let username = sku.borrowedByUsername { detailRow("ID", value: username) }
                if let at = sku.borrowedAt { detailRow("Since", value: at) }
            }
        } else if sku.status == .repairing {
            Section("Repair Request") {
                if let name = sku.repairRequestedByName, !name.isEmpty { detailRow("Requested by", value: name) }
                if let reason = sku.repairReason, !reason.isEmpty { detailRow("Reason", value: reason) }
                if let dest = sku.repairDestination, !dest.isEmpty { detailRow("Send to", value: dest) }
                if let at = sku.repairStartedAt, !at.isEmpty { detailRow("Since", value: at) }
            }
        }
    }

    @ViewBuilder
    private var actionsSection: some View {
        Section("Actions") {
            switch sku.status {
            case .available:
                if canManage {
                    if isSuperadmin {
                        Button { actionError = nil; showingEditScanner = true } label: {
                            Label("Edit", systemImage: "pencil")
                        }
                    }
                    if canRepair {
                        Button { showingActionScanner = true } label: {
                            Label("Request Repair", systemImage: "wrench.and.screwdriver")
                        }
                    }
                    Button { showingTransfer = true } label: {
                        Label("Transfer", systemImage: "arrow.triangle.swap")
                    }
                    if canRequestDisposal {
                        Button(role: .destructive) { showingDisposal = true } label: {
                            Label("Request Disposal", systemImage: "xmark.bin")
                        }
                    }
                } else {
                    Text("No actions available.").foregroundStyle(.secondary).font(.subheadline)
                }
            case .borrowed:
                Button { actionError = nil; showingReturnScan = true } label: {
                    Label("Return", systemImage: "arrow.uturn.left")
                }
            case .repairing:
                if canReturnFromRepair {
                    Button { actionError = nil; showingReturnScan = true } label: {
                        Label("Return from Repair", systemImage: "checkmark.circle")
                    }
                }
            case .disposed, .sold:
                Text("No actions available.").foregroundStyle(.secondary).font(.subheadline)
            }
        }
    }

    @ViewBuilder
    private var activitySection: some View {
        Section("Recent Activity (7 days)") {
            let recent = recentRecords
            if recent.isEmpty {
                Text("No activity in the past 7 days.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(recent) { record in
                    recordRow(record)
                }
            }
        }
    }

    private func recordRow(_ record: InventoryRecord) -> some View {
        HStack(spacing: 12) {
            Image(systemName: recordIcon(record.type))
                .foregroundStyle(recordColor(record.type))
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(recordLabel(record.type)).font(.subheadline)
                if let name = operatorName(for: record) {
                    Text(name).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let at = record.createdAt {
                Text(formatShortDate(at)).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }

    private func detailRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).multilineTextAlignment(.trailing)
        }
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

    private func operatorName(for record: InventoryRecord) -> String? {
        guard let opId = record.operatorId else { return nil }
        return appState.users.first { $0.id == opId }?.name
    }

    private func formatShortDate(_ value: String) -> String {
        guard let date = parseISODate(value) else { return value }
        if Calendar.current.isDateInToday(date) {
            return date.formatted(.dateTime.hour().minute())
        }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    private func parseISODate(_ value: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: value) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: value)
    }
}

// MARK: - Add SKU

private struct AddSKUSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var selectedCompanyId = ""
    @State private var selectedBranchId = ""
    @State private var selectedLocationId = ""
    @State private var selectedCategoryId = ""
    @State private var skuSuffix = ""
    @State private var selectedDescriptionId: String? = nil
    @State private var customDescriptionText = ""
    @State private var serialNumber = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var selectedCompany: Company? {
        appState.companies.first { $0.id == selectedCompanyId }
    }

    private var availableBranches: [Park] {
        selectedCompany?.branches.sorted { $0.name < $1.name } ?? []
    }

    private var selectedBranch: Park? {
        availableBranches.first { $0.id == selectedBranchId }
    }

    private var availableLocations: [StockLocation] {
        (selectedBranch?.locations ?? []).sorted { $0.name < $1.name }
    }

    private var branchHasLocations: Bool {
        !availableLocations.isEmpty
    }

    private var availableCategories: [Category] {
        selectedCompany?.categories.sorted { $0.code < $1.code } ?? []
    }

    private var availableDescriptions: [EquipmentDescription] {
        selectedCompany?.descriptions ?? []
    }

    private var skuPreview: String? {
        guard !selectedCompanyId.isEmpty, !selectedCategoryId.isEmpty, skuSuffix.count == 4 else { return nil }
        let compCode = selectedCompany?.code ?? "???"
        let catCode = availableCategories.first { $0.id == selectedCategoryId }?.code ?? "???"
        return "\(compCode)-\(catCode)-\(skuSuffix)"
    }

    private var canSubmit: Bool {
        !selectedCompanyId.isEmpty &&
        !selectedBranchId.isEmpty &&
        (!branchHasLocations || !selectedLocationId.isEmpty) &&
        !selectedCategoryId.isEmpty &&
        skuSuffix.count == 4 &&
        (selectedDescriptionId != nil || !customDescriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Location") {
                    Picker("Company", selection: $selectedCompanyId) {
                        Text("Select a company").tag("")
                        ForEach(appState.companies) { company in
                            Text(company.name).tag(company.id)
                        }
                    }
                    Picker("Branch", selection: $selectedBranchId) {
                        Text("Select a branch").tag("")
                        ForEach(availableBranches) { branch in
                            Text(branch.name).tag(branch.id)
                        }
                    }
                    .disabled(availableBranches.isEmpty)
                    if branchHasLocations {
                        Picker("Location", selection: $selectedLocationId) {
                            Text("Select a location").tag("")
                            ForEach(availableLocations) { location in
                                Text(location.name).tag(location.id)
                            }
                        }
                    }
                    Picker("Category", selection: $selectedCategoryId) {
                        Text("Select a category").tag("")
                        ForEach(availableCategories) { cat in
                            Text(cat.code).tag(cat.id)
                        }
                    }
                    .disabled(availableCategories.isEmpty)
                }

                Section("SKU") {
                    TextField("4-digit suffix", text: $skuSuffix)
                        .keyboardType(.numberPad)
                    if let preview = skuPreview {
                        Text(preview)
                            .font(.subheadline.monospaced())
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Description") {
                    if !availableDescriptions.isEmpty {
                        Picker("Preset", selection: $selectedDescriptionId) {
                            Text("Custom text").tag(nil as String?)
                            ForEach(availableDescriptions) { d in
                                Text(d.text).tag(Optional(d.id))
                            }
                        }
                    }
                    if selectedDescriptionId == nil {
                        TextField("Description", text: $customDescriptionText, axis: .vertical)
                            .lineLimit(2...)
                    }
                }

                Section("Serial Number (optional)") {
                    TextField("SN", text: $serialNumber)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red).font(.footnote)
                    }
                }
            }
            .navigationTitle("Add Item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Add") { submit() }.disabled(!canSubmit)
                    }
                }
            }
        }
        .onChange(of: selectedCompanyId) { _ in
            selectedBranchId = ""
            selectedLocationId = ""
            selectedCategoryId = ""
            selectedDescriptionId = nil
            customDescriptionText = ""
        }
        .onChange(of: selectedBranchId) { _ in
            selectedLocationId = ""
        }
        .onChange(of: skuSuffix) { newVal in
            let filtered = String(newVal.filter { $0.isNumber }.prefix(4))
            if skuSuffix != filtered { skuSuffix = filtered }
        }
        .interactiveDismissDisabled(isSubmitting)
    }

    private func submit() {
        guard canSubmit else { return }
        let descText = selectedDescriptionId == nil
            ? customDescriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
            : nil
        let sn = serialNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                _ = try await appState.createSKU(
                    warehouseId: selectedCompanyId,
                    branchId: selectedBranchId,
                    categoryId: selectedCategoryId,
                    locationId: selectedLocationId.isEmpty ? nil : selectedLocationId,
                    skuNumber: skuSuffix,
                    descriptionId: selectedDescriptionId,
                    descriptionText: descText?.isEmpty == true ? nil : descText,
                    serialNumber: sn.isEmpty ? nil : sn
                )
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Edit SKU Sheet (superadmin, available only)

private struct EditSKUSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let sku: SKUItem

    @State private var selectedBranchId = ""
    @State private var selectedLocationId = ""
    @State private var selectedCategoryId = ""
    @State private var skuNumberInput = ""
    @State private var selectedDescriptionId: String? = nil
    @State private var customDescriptionText = ""
    @State private var serialNumber = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var company: Company? {
        appState.companies.first { $0.id == sku.warehouseId }
    }
    private var availableBranches: [Park] {
        company?.branches.sorted { $0.name < $1.name } ?? []
    }
    private var selectedBranch: Park? {
        availableBranches.first { $0.id == selectedBranchId }
    }
    private var availableLocations: [StockLocation] {
        (selectedBranch?.locations ?? []).sorted { $0.name < $1.name }
    }
    private var branchHasLocations: Bool { !availableLocations.isEmpty }
    private var availableCategories: [Category] {
        company?.categories.sorted { $0.code < $1.code } ?? []
    }
    private var availableDescriptions: [EquipmentDescription] {
        company?.descriptions ?? []
    }

    private var currentNumber: String {
        (sku.skuCode ?? "").split(separator: "-").last.map(String.init) ?? ""
    }

    /// Numbers already taken in this company + selected category (excluding this SKU).
    private var usedNumbers: Set<Int> {
        let nums = appState.skus
            .filter { $0.id != sku.id && $0.warehouseId == sku.warehouseId && $0.categoryId == selectedCategoryId }
            .compactMap { s -> Int? in
                guard let last = (s.skuCode ?? "").split(separator: "-").last else { return nil }
                return Int(last)
            }
        return Set(nums)
    }

    private var isAutoFill: Bool {
        skuNumberInput.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// The number that will be used: the typed value, or the smallest free gap when blank.
    private var effectiveNumber: Int? {
        if isAutoFill {
            var n = 1
            while usedNumbers.contains(n) { n += 1 }
            return n
        }
        return Int(skuNumberInput.trimmingCharacters(in: .whitespaces))
    }

    /// True when a typed number collides with an existing SKU in this company + category.
    private var isDuplicate: Bool {
        guard !isAutoFill, let n = effectiveNumber else { return false }
        return usedNumbers.contains(n)
    }

    private var paddedNumber: String? {
        guard let n = effectiveNumber else { return nil }
        return String(format: "%04d", n)
    }

    /// Live SKU code preview — updates as the category or number changes.
    private var skuPreview: String? {
        guard let comp = company?.code,
              let cat = availableCategories.first(where: { $0.id == selectedCategoryId })?.code,
              let num = paddedNumber else { return nil }
        return "\(comp)-\(cat)-\(num)"
    }

    private var previewColor: Color { isDuplicate ? .red : .green }

    private var canSubmit: Bool {
        !selectedBranchId.isEmpty &&
        (!branchHasLocations || !selectedLocationId.isEmpty) &&
        !selectedCategoryId.isEmpty &&
        effectiveNumber != nil &&
        !isDuplicate
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Item") {
                    HStack { Text("Company"); Spacer(); Text(company?.name ?? "").foregroundStyle(.secondary) }
                    HStack {
                        Text("Number")
                        TextField("auto", text: $skuNumberInput)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                    }
                    if let preview = skuPreview {
                        HStack {
                            Text("SKU"); Spacer()
                            if isAutoFill {
                                Text("auto").font(.caption2).foregroundStyle(.secondary)
                            }
                            Text(preview).font(.subheadline.monospaced().bold()).foregroundStyle(previewColor)
                        }
                    }
                    if isDuplicate {
                        Text("This SKU code already exists — pick another number or leave blank to auto-fill.")
                            .font(.caption).foregroundStyle(.red)
                    }
                }
                Section("Location") {
                    Picker("Branch", selection: $selectedBranchId) {
                        Text("Select a branch").tag("")
                        ForEach(availableBranches) { branch in
                            Text(branch.name).tag(branch.id)
                        }
                    }
                    if branchHasLocations {
                        Picker("Location", selection: $selectedLocationId) {
                            Text("Select a location").tag("")
                            ForEach(availableLocations) { location in
                                Text(location.name).tag(location.id)
                            }
                        }
                    }
                    Picker("Category", selection: $selectedCategoryId) {
                        Text("Select a category").tag("")
                        ForEach(availableCategories) { cat in
                            Text(cat.code).tag(cat.id)
                        }
                    }
                    .disabled(availableCategories.isEmpty)
                }
                Section("Description") {
                    if !availableDescriptions.isEmpty {
                        Picker("Preset", selection: $selectedDescriptionId) {
                            Text("Custom text").tag(nil as String?)
                            ForEach(availableDescriptions) { d in
                                Text(d.text).tag(Optional(d.id))
                            }
                        }
                    }
                    if selectedDescriptionId == nil {
                        TextField("Description", text: $customDescriptionText, axis: .vertical)
                            .lineLimit(2...)
                    }
                }
                Section("Serial Number (optional)") {
                    TextField("SN", text: $serialNumber)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red).font(.footnote)
                    }
                }
            }
            .navigationTitle("Edit Item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting { ProgressView() }
                    else { Button("Save") { submit() }.disabled(!canSubmit) }
                }
            }
        }
        .onAppear {
            selectedBranchId = sku.branchId ?? ""
            selectedLocationId = sku.locationId ?? ""
            selectedCategoryId = sku.categoryId ?? ""
            skuNumberInput = currentNumber
            selectedDescriptionId = sku.descriptionId
            customDescriptionText = sku.descriptionId == nil ? (sku.descriptionText ?? "") : ""
            serialNumber = sku.serialNumber ?? ""
        }
        .onChange(of: selectedBranchId) { _ in
            if !availableLocations.contains(where: { $0.id == selectedLocationId }) {
                selectedLocationId = ""
            }
        }
        .onChange(of: skuNumberInput) { newVal in
            let filtered = String(newVal.filter(\.isNumber).prefix(4))
            if skuNumberInput != filtered { skuNumberInput = filtered }
        }
        .interactiveDismissDisabled(isSubmitting)
    }

    private func submit() {
        guard canSubmit else { return }
        let sn = serialNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        let descText = selectedDescriptionId == nil
            ? customDescriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
            : nil
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                _ = try await appState.updateSKU(
                    id: sku.id,
                    categoryId: selectedCategoryId,
                    branchId: selectedBranchId,
                    locationId: selectedLocationId.isEmpty ? nil : selectedLocationId,
                    skuNumber: paddedNumber,
                    descriptionId: selectedDescriptionId,
                    descriptionText: descText?.isEmpty == true ? nil : descText,
                    serialNumber: sn.isEmpty ? nil : sn
                )
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Repair Sheet

struct RepairSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let sku: SKUItem

    @State private var reason = ""
    @State private var destination = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Repair Request") {
                    TextField("Reason for repair", text: $reason, axis: .vertical)
                        .lineLimit(3...)
                    TextField("Send to (destination)", text: $destination)
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red).font(.footnote)
                    }
                }
            }
            .navigationTitle("Request Repair")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Submit") { submit() }
                            .disabled(
                                reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                                destination.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            )
                    }
                }
            }
        }
        .interactiveDismissDisabled(isSubmitting)
    }

    private func submit() {
        let r = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        let d = destination.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !r.isEmpty, !d.isEmpty else { return }
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                _ = try await appState.requestRepair(skuCode: sku.displayCode, reason: r, destination: d)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Transfer Sheet

private struct TransferSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let sku: SKUItem

    @State private var selectedBranchId = ""
    @State private var reason = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var transferableBranches: [Park] {
        let company = appState.companies.first { $0.id == sku.warehouseId }
        return company?.branches.filter { $0.id != sku.branchId } ?? []
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Transfer To") {
                    if transferableBranches.isEmpty {
                        Text("No other branches available in this company.")
                            .foregroundStyle(.secondary)
                            .font(.subheadline)
                    } else {
                        Picker("Branch", selection: $selectedBranchId) {
                            Text("Select a branch").tag("")
                            ForEach(transferableBranches) { b in
                                Text(b.name).tag(b.id)
                            }
                        }
                    }
                    TextField("Reason", text: $reason, axis: .vertical)
                        .lineLimit(2...)
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red).font(.footnote)
                    }
                }
            }
            .navigationTitle("Transfer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Submit") { submit() }
                            .disabled(selectedBranchId.isEmpty || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
        .interactiveDismissDisabled(isSubmitting)
    }

    private func submit() {
        let r = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !selectedBranchId.isEmpty, !r.isEmpty else { return }
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                _ = try await appState.requestTransfer(skuCode: sku.displayCode, toBranchId: selectedBranchId, reason: r)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Disposal Sheet

private struct DisposalSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let sku: SKUItem

    @State private var reason = ""
    @State private var netBookValue = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Disposal Request") {
                    TextField("Reason for disposal", text: $reason, axis: .vertical)
                        .lineLimit(3...)
                    TextField("Net book value", text: $netBookValue)
                        .keyboardType(.decimalPad)
                }
                Section {
                    Label("This will be sent to superadmin for approval.", systemImage: "info.circle")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red).font(.footnote)
                    }
                }
            }
            .navigationTitle("Request Disposal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Submit") { submit() }
                            .disabled(
                                reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                                netBookValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            )
                    }
                }
            }
        }
        .interactiveDismissDisabled(isSubmitting)
    }

    private func submit() {
        let r = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        let nbv = netBookValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !r.isEmpty, !nbv.isEmpty else { return }
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                _ = try await appState.requestDisposal(skuCode: sku.displayCode, reason: r, netBookValue: nbv)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
