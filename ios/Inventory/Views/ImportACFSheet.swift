import SwiftUI
import UniformTypeIdentifiers

/// Import an exported Asset Check Form: pick company + branch + file, the server
/// diffs it against inventory into New / Mismatched / Already-correct, then the
/// user picks what to apply (create new SKUs, update mismatched ones).
struct ImportACFSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var companyId = ""
    @State private var branchId = ""
    @State private var fileName = ""
    @State private var fileBase64 = ""
    @State private var showFileImporter = false
    @State private var isWorking = false
    @State private var errorMessage: String?

    @State private var diff: ImportDiff?
    @State private var createSel: Set<String> = []   // assetId
    @State private var updateSel: Set<String> = []   // skuId

    /// Per-remark placement: transfer an existing SKU, or assign a new one, to a
    /// chosen branch + location. Keyed by the remark's id.
    struct Placement { var active: Bool; var branchId: String; var location: String }
    @State private var placements: [String: Placement] = [:]

    private func bindingActive(_ r: ImportRemark) -> Binding<Bool> {
        Binding(get: { placements[r.id]?.active ?? false },
                set: { on in placements[r.id]?.active = on; if !on { placements[r.id]?.branchId = ""; placements[r.id]?.location = "" } })
    }
    private func bindingBranch(_ r: ImportRemark) -> Binding<String> {
        Binding(get: { placements[r.id]?.branchId ?? "" },
                set: { placements[r.id]?.branchId = $0; placements[r.id]?.location = "" })   // reset location on branch change
    }
    private func bindingLocation(_ r: ImportRemark) -> Binding<String> {
        Binding(get: { placements[r.id]?.location ?? "" }, set: { placements[r.id]?.location = $0 })
    }

    private var company: Company? { appState.companies.first { $0.id == companyId } }
    private var branches: [Park] { (company?.branches ?? []).sorted { $0.name < $1.name } }
    private func locationsOf(_ branchId: String) -> [StockLocation] {
        (branches.first { $0.id == branchId }?.locations ?? []).sorted { $0.name < $1.name }
    }
    /// All active placements have a branch, plus a location when that branch has any.
    private var placementsComplete: Bool {
        (diff?.remarks ?? []).allSatisfy { r in
            guard let p = placements[r.id], p.active else { return true }
            if p.branchId.isEmpty { return false }
            if !locationsOf(p.branchId).isEmpty && p.location.isEmpty { return false }
            return true
        }
    }
    private var canAnalyze: Bool { !companyId.isEmpty && !branchId.isEmpty && !fileBase64.isEmpty && !isWorking }

    var body: some View {
        NavigationStack {
            Group {
                if let diff { reviewView(diff) } else { pickView }
            }
            .navigationTitle(diff == nil ? "Import Asset Form" : "Review Import")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .fileImporter(isPresented: $showFileImporter,
                          allowedContentTypes: [.spreadsheet, .commaSeparatedText, UTType(filenameExtension: "xlsx") ?? .data].compactMap { $0 },
                          allowsMultipleSelection: false) { result in
                handleFile(result)
            }
        }
    }

    // MARK: Pick

    private var pickView: some View {
        Form {
            Section {
                Picker("Company", selection: $companyId) {
                    Text("Select a company").tag("")
                    ForEach(appState.companies) { Text($0.name).tag($0.id) }
                }
                .onChange(of: companyId) { _ in branchId = "" }
                Picker("Branch", selection: $branchId) {
                    Text("Select a branch").tag("")
                    ForEach(branches) { Text($0.name).tag($0.id) }
                }
            }
            Section {
                Button {
                    showFileImporter = true
                } label: {
                    HStack {
                        Image(systemName: "doc.badge.plus")
                        Text(fileName.isEmpty ? "Choose Asset Check Form (.xlsx)" : fileName)
                            .lineLimit(1)
                        Spacer()
                    }
                }
            } footer: {
                Text("Each ASSET ID is matched against your inventory; we'll show what's new, what differs, and what already matches.")
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red).font(.footnote) }
            }
            Section {
                Button {
                    Task { await analyze() }
                } label: {
                    HStack { Spacer(); if isWorking { ProgressView() } else { Text("Analyze") }; Spacer() }
                }
                .disabled(!canAnalyze)
            }
        }
    }

    // MARK: Review

    private func reviewView(_ diff: ImportDiff) -> some View {
        VStack(spacing: 0) {
            List {
                Section {
                    HStack(spacing: 16) {
                        countPill("New", diff.counts.new, .green)
                        countPill("Mismatched", diff.counts.mismatched, .orange)
                        countPill("Correct", diff.counts.existing, .blue)
                    }
                }
                if !diff.newItems.isEmpty {
                    Section("New — will be created") {
                        ForEach(diff.newItems) { item in
                            toggleRow(isOn: createSel.contains(item.assetId)) {
                                toggle(&createSel, item.assetId)
                            } content: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.assetId).font(.headline)
                                    Text([item.description, item.serial.isEmpty ? nil : "SN: \(item.serial)", item.location].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                if !diff.mismatched.isEmpty {
                    Section("Mismatched — will be updated") {
                        ForEach(diff.mismatched) { item in
                            toggleRow(isOn: updateSel.contains(item.skuId)) {
                                toggle(&updateSel, item.skuId)
                            } content: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.assetId).font(.headline)
                                    ForEach(item.diffs, id: \.field) { d in
                                        Text("\(d.field): \(d.current.isEmpty ? "—" : d.current) → \(d.imported.isEmpty ? "—" : d.imported)")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
                if let locs = diff.newLocations, !locs.isEmpty {
                    Section("New locations — will be created (\(locs.count))") {
                        Text(locs.joined(separator: ", "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if !diff.existing.isEmpty {
                    Section("Already correct (\(diff.existing.count)) — no change") {
                        Text(diff.existing.map { $0.assetId }.joined(separator: ", "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if diff.newItems.isEmpty && diff.mismatched.isEmpty {
                    Section { Text("Everything already matches — nothing to import.").foregroundStyle(.secondary) }
                }
                // Remarks (your column-J notes, e.g. "To OW") at the very bottom.
                if let remarks = diff.remarks, !remarks.isEmpty {
                    Section {
                        ForEach(remarks) { r in
                            // Header (asset + remark + toggle) is one row; the Branch
                            // and Location pickers are SEPARATE rows so they lay out
                            // like the Add-Inventory pickers (no overlap).
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(r.assetId).font(.subheadline.weight(.semibold))
                                    Text(r.skuId == nil ? "not in inventory" : "existing")
                                        .font(.caption2).foregroundStyle(r.skuId == nil ? .orange : .secondary)
                                }
                                Text(r.remark).font(.callout).foregroundStyle(.orange)
                                Toggle(r.skuId == nil ? "Assign branch / location" : "Transfer to another branch / location",
                                       isOn: bindingActive(r))
                            }
                            if placements[r.id]?.active == true {
                                Picker("Branch", selection: bindingBranch(r)) {
                                    Text("Not selected").tag("")
                                    ForEach(branches) { Text($0.name).tag($0.id) }
                                }
                                let locs = locationsOf(placements[r.id]?.branchId ?? "")
                                if !locs.isEmpty {
                                    Picker("Location", selection: bindingLocation(r)) {
                                        Text("Not selected").tag("")
                                        ForEach(locs) { Text($0.name).tag($0.name) }
                                    }
                                }
                            }
                        }
                    } header: {
                        Label("Remarks — needs attention (\(remarks.count))", systemImage: "flag.fill")
                            .foregroundStyle(.orange)
                    }
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red).font(.footnote) }
                }
            }
            Divider()
            HStack {
                Button("Back") { self.diff = nil }
                    .buttonStyle(.bordered)
                Spacer()
                Button {
                    Task { await apply() }
                } label: {
                    HStack { if isWorking { ProgressView() }; Text("Apply") }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isWorking
                          || (createSel.isEmpty && updateSel.isEmpty && !placements.values.contains { $0.active })
                          || !placementsComplete)
            }
            .padding()
        }
    }

    private func countPill(_ label: String, _ n: Int, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(n)").font(.title3.bold()).foregroundStyle(color)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func toggleRow<Content: View>(isOn: Bool, action: @escaping () -> Void, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(isOn ? Color.accentColor : Color.secondary)
                .onTapGesture { action() }
            content()
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .onTapGesture { action() }
    }

    private func toggle(_ set: inout Set<String>, _ key: String) {
        if set.contains(key) { set.remove(key) } else { set.insert(key) }
    }

    // MARK: Actions

    private func handleFile(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: url)
                fileBase64 = data.base64EncodedString()
                fileName = url.lastPathComponent
                errorMessage = nil
            } catch {
                errorMessage = "Couldn't read the file: \(error.localizedDescription)"
            }
        case .failure(let error):
            errorMessage = error.localizedDescription
        }
    }

    private func analyze() async {
        isWorking = true; errorMessage = nil
        defer { isWorking = false }
        do {
            let d = try await appState.api.importParse(companyId: companyId, branchId: branchId, fileBase64: fileBase64)
            createSel = Set(d.newItems.map { $0.assetId })
            updateSel = Set(d.mismatched.map { $0.skuId })
            // Default unselected — the user opts in and picks branch (+ location if
            // the branch has any), like the Add-Inventory flow.
            var pl: [String: Placement] = [:]
            for r in d.remarks ?? [] {
                pl[r.id] = Placement(active: false, branchId: "", location: "")
            }
            placements = pl
            diff = d
        } catch {
            errorMessage = (error as? APIClientError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func apply() async {
        guard let diff else { return }
        isWorking = true; errorMessage = nil
        defer { isWorking = false }
        let create: [[String: Any]] = diff.newItems.filter { createSel.contains($0.assetId) }.map {
            ["assetId": $0.assetId, "description": $0.description, "serial": $0.serial, "location": $0.location]
        }
        let update: [[String: Any]] = diff.mismatched.filter { updateSel.contains($0.skuId) }.map {
            ["skuId": $0.skuId, "assetId": $0.assetId, "description": $0.description, "serial": $0.serial, "location": $0.location]
        }
        // Remark placements (transfers / explicit new-item branch assignment).
        let place: [[String: Any]] = (diff.remarks ?? []).compactMap { r in
            guard let p = placements[r.id], p.active, !p.branchId.isEmpty else { return nil }
            var entry: [String: Any] = ["assetId": r.assetId, "branchId": p.branchId, "location": p.location,
                                        "description": r.description ?? "", "serial": r.serial ?? ""]
            if let skuId = r.skuId { entry["skuId"] = skuId }
            return entry
        }
        do {
            _ = try await appState.api.importApply(companyId: companyId, branchId: branchId, create: create, update: update, place: place)
            try? await appState.refresh()
            dismiss()
        } catch {
            errorMessage = (error as? APIClientError)?.errorDescription ?? error.localizedDescription
        }
    }
}
