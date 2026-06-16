import SwiftUI

// MARK: - Company List

struct CompanyListView: View {
    @EnvironmentObject private var appState: AppState
    @State private var showingAdd = false
    @State private var editTarget: Company?
    @State private var pendingDelete: Company?
    @State private var deleteError: String?
    @State private var searchText = ""

    private var displayedCompanies: [Company] {
        if searchText.isEmpty { return appState.companies }
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return appState.companies.filter {
            $0.name.lowercased().contains(q) || $0.code.lowercased().contains(q)
        }
    }

    var body: some View {
        List {
            if displayedCompanies.isEmpty {
                EmptyStateView(title: appState.companies.isEmpty ? "No companies yet" : "No results", systemImage: "building.2")
            } else {
                ForEach(displayedCompanies) { company in
                    Section {
                        NavigationLink {
                            BranchListView(companyId: company.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(company.name)
                                    .font(.headline)
                                Text(company.code)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                pendingDelete = company
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        .swipeActions(edge: .leading, allowsFullSwipe: false) {
                            Button {
                                editTarget = company
                            } label: {
                                Label("Edit", systemImage: "pencil")
                            }
                            .tint(.blue)
                        }
                    }
                }
            }
        }
        .compactListSections()
        .navigationTitle("Company")
        .searchable(text: $searchText, prompt: "Search by name or code")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingAdd = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showingAdd) {
            CompanyFormSheet(mode: .create)
        }
        .sheet(item: $editTarget) { company in
            CompanyFormSheet(mode: .edit(company))
        }
        .confirmationDialog(
            "Delete \"\(pendingDelete?.name ?? "")\"?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let c = pendingDelete { deleteCompany(c) }
                pendingDelete = nil
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        } message: {
            Text("This permanently deletes the company and all its branches, locations and categories. This cannot be undone.")
        }
        .alert(
            "Can't Delete",
            isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } }),
            presenting: deleteError
        ) { _ in
            Button("OK", role: .cancel) { deleteError = nil }
        } message: { msg in
            Text(msg)
        }
    }

    private func deleteCompany(_ company: Company) {
        Task {
            do {
                try await appState.deleteCompany(id: company.id)
            } catch {
                deleteError = (error as? APIClientError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

// MARK: - Company Form

private enum CompanyFormMode {
    case create
    case edit(Company)
}

private struct CompanyFormSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let mode: CompanyFormMode

    @State private var fullName = ""
    @State private var shortCode = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var isEditing: Bool {
        if case .edit = mode { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Full name", text: $fullName)
                    TextField("Short code (e.g. PWBJ)", text: $shortCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                } footer: {
                    Text("The short code is used as a prefix on SKU codes.")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle(isEditing ? "Edit Company" : "New Company")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button(isEditing ? "Save" : "Add") { submit() }
                            .disabled(
                                fullName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                                shortCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            )
                    }
                }
            }
        }
        .onAppear {
            if case .edit(let c) = mode {
                fullName = c.name
                shortCode = c.code
            }
        }
        .interactiveDismissDisabled(isSubmitting)
    }

    private func submit() {
        let name = fullName.trimmingCharacters(in: .whitespacesAndNewlines)
        let code = shortCode.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !name.isEmpty, !code.isEmpty else { return }
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                switch mode {
                case .create:
                    try await appState.createCompany(name: name, code: code)
                case .edit(let c):
                    try await appState.updateCompany(id: c.id, name: name, code: code)
                }
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Branch List

struct BranchListView: View {
    @EnvironmentObject private var appState: AppState
    let companyId: String

    @State private var showingAdd = false
    @State private var editTarget: Park?
    @State private var pendingDelete: Park?
    @State private var errorMessage: String?

    private var company: Company? {
        appState.companies.first { $0.id == companyId }
    }

    var body: some View {
        List {
            let branches = company?.branches ?? []
            if branches.isEmpty {
                EmptyStateView(title: "No branches yet", systemImage: "building")
            } else {
                ForEach(branches) { branch in
                    Section {
                        NavigationLink {
                            LocationListView(companyId: companyId, branchId: branch.id)
                        } label: {
                            HStack {
                                Text(branch.name)
                                Spacer()
                                if let locs = branch.locations, !locs.isEmpty {
                                    Text("\(locs.count) location\(locs.count == 1 ? "" : "s")")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                pendingDelete = branch
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        .swipeActions(edge: .leading, allowsFullSwipe: false) {
                            Button {
                                editTarget = branch
                            } label: {
                                Label("Edit", systemImage: "pencil")
                            }
                            .tint(.blue)
                        }
                    }
                }
            }
        }
        .compactListSections()
        .navigationTitle(company?.name ?? "Branches")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingAdd = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showingAdd) {
            BranchFormSheet(companyId: companyId, mode: .create)
        }
        .sheet(item: $editTarget) { branch in
            BranchFormSheet(companyId: companyId, mode: .edit(branch))
        }
        .confirmationDialog(
            "Delete \"\(pendingDelete?.name ?? "")\"?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let b = pendingDelete { deleteBranch(b) }
                pendingDelete = nil
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        } message: {
            Text("This action cannot be undone.")
        }
        .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func deleteBranch(_ branch: Park) {
        Task {
            do {
                try await appState.deleteBranch(companyId: companyId, parkId: branch.id)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Location List (child of branch)

struct LocationListView: View {
    @EnvironmentObject private var appState: AppState
    let companyId: String
    let branchId: String

    @State private var showingAdd = false
    @State private var editTarget: StockLocation?
    @State private var pendingDelete: StockLocation?
    @State private var errorMessage: String?

    private var branch: Park? {
        appState.companies.first { $0.id == companyId }?.branches.first { $0.id == branchId }
    }

    var body: some View {
        List {
            let locations = branch?.locations ?? []
            if locations.isEmpty {
                EmptyStateView(title: "No locations yet", systemImage: "mappin.and.ellipse")
            } else {
                ForEach(locations) { location in
                    Section {
                        Text(location.name)
                            .padding(.vertical, 4)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    pendingDelete = location
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                            .swipeActions(edge: .leading, allowsFullSwipe: false) {
                                Button {
                                    editTarget = location
                                } label: {
                                    Label("Edit", systemImage: "pencil")
                                }
                                .tint(.blue)
                            }
                    }
                }
            }
        }
        .compactListSections()
        .navigationTitle(branch?.name ?? "Locations")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingAdd = true } label: { Image(systemName: "plus") }
            }
        }
        .sheet(isPresented: $showingAdd) {
            LocationFormSheet(companyId: companyId, branchId: branchId, mode: .create)
        }
        .sheet(item: $editTarget) { location in
            LocationFormSheet(companyId: companyId, branchId: branchId, mode: .edit(location))
        }
        .confirmationDialog(
            "Delete \"\(pendingDelete?.name ?? "")\"?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let l = pendingDelete { deleteLocation(l) }
                pendingDelete = nil
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        } message: {
            Text("This action cannot be undone.")
        }
        .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func deleteLocation(_ location: StockLocation) {
        Task {
            do {
                try await appState.deleteLocation(companyId: companyId, branchId: branchId, locationId: location.id)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

private enum LocationFormMode {
    case create
    case edit(StockLocation)
}

private struct LocationFormSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let companyId: String
    let branchId: String
    let mode: LocationFormMode

    @State private var name = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var isEditing: Bool {
        if case .edit = mode { return true }
        return false
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Location") {
                    TextField("Name (e.g. Shelf A1)", text: $name)
                }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red).font(.footnote)
                }
            }
            .navigationTitle(isEditing ? "Edit Location" : "New Location")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting { ProgressView() }
                    else { Button(isEditing ? "Save" : "Add") { submit() }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty) }
                }
            }
        }
        .onAppear {
            if case .edit(let l) = mode { name = l.name }
        }
        .interactiveDismissDisabled(isSubmitting)
    }

    private func submit() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                switch mode {
                case .create:
                    try await appState.addLocation(companyId: companyId, branchId: branchId, name: trimmed)
                case .edit(let l):
                    try await appState.updateLocation(companyId: companyId, branchId: branchId, locationId: l.id, name: trimmed)
                }
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Branch Form

private enum BranchFormMode {
    case create
    case edit(Park)
}

private struct BranchFormSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let companyId: String
    let mode: BranchFormMode

    @State private var name = ""
    @State private var endorserUserId: String? = nil
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var showingEndorserPicker = false

    private var isEditing: Bool {
        if case .edit = mode { return true }
        return false
    }

    private var endorserName: String? {
        appState.users.first { $0.id == endorserUserId }?.name
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Branch name", text: $name)
                }
                Section {
                    Button { showingEndorserPicker = true } label: {
                        HStack {
                            Text("Endorser").foregroundStyle(.primary)
                            Spacer()
                            Text(endorserName ?? "None")
                                .foregroundStyle(endorserName == nil ? .secondary : .primary)
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                } footer: {
                    Text("The person who signs this branch's Asset Check Form. Must be an existing user.")
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle(isEditing ? "Edit Branch" : "New Branch")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showingEndorserPicker) {
                EndorserPickerSheet(selectedUserId: $endorserUserId)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button(isEditing ? "Save" : "Add") { submit() }
                            .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
        .onAppear {
            if case .edit(let b) = mode {
                name = b.name
                endorserUserId = b.endorserUserId
            }
        }
        .interactiveDismissDisabled(isSubmitting)
    }

    private func submit() {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                switch mode {
                case .create:
                    try await appState.addBranch(companyId: companyId, name: trimmed, endorserUserId: endorserUserId)
                case .edit(let b):
                    try await appState.updateBranch(companyId: companyId, parkId: b.id, name: trimmed, endorserUserId: endorserUserId)
                }
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Endorser Picker (searchable user list)

private struct EndorserPickerSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    @Binding var selectedUserId: String?
    @State private var search = ""

    private var filtered: [User] {
        let users = appState.users.sorted { $0.name < $1.name }
        guard !search.isEmpty else { return users }
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return users.filter {
            $0.name.lowercased().contains(q) ||
            ($0.phone?.contains(q) == true) ||
            $0.username.lowercased().contains(q)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Button {
                    selectedUserId = nil
                    dismiss()
                } label: {
                    HStack {
                        Text("None").foregroundStyle(.primary)
                        Spacer()
                        if selectedUserId == nil {
                            Image(systemName: "checkmark").foregroundStyle(.blue)
                        }
                    }
                }
                ForEach(filtered) { user in
                    Button {
                        selectedUserId = user.id
                        dismiss()
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(user.name).foregroundStyle(.primary)
                                Text(user.role.displayName)
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if selectedUserId == user.id {
                                Image(systemName: "checkmark").foregroundStyle(.blue)
                            }
                        }
                    }
                }
            }
            .searchable(text: $search, prompt: "Search by name or phone")
            .navigationTitle("Endorser")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
