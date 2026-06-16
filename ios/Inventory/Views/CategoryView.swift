import SwiftUI

// MARK: - Helpers

private struct CategoryWithContext: Identifiable {
    var id: String { category.id }
    let category: Category
    let company: Company
}

// MARK: - Category List

struct CategoryListView: View {
    @EnvironmentObject private var appState: AppState
    @State private var showingAdd = false
    @State private var editTarget: CategoryWithContext?
    @State private var pendingDelete: CategoryWithContext?
    @State private var filterCompanyId: String? = nil
    @State private var searchText = ""

    private var allCategories: [CategoryWithContext] {
        appState.companies.flatMap { company in
            company.categories.map { CategoryWithContext(category: $0, company: company) }
        }.sorted { $0.category.code < $1.category.code }
    }

    private var displayedCategories: [CategoryWithContext] {
        var result = filterCompanyId == nil ? allCategories : allCategories.filter { $0.company.id == filterCompanyId }
        if !searchText.isEmpty {
            let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            result = result.filter {
                $0.category.code.lowercased().contains(q) ||
                $0.company.name.lowercased().contains(q) ||
                $0.company.code.lowercased().contains(q)
            }
        }
        return result
    }

    private var companiesWithCategories: [Company] {
        appState.companies.filter { !$0.categories.isEmpty }
    }

    var body: some View {
        List {
            if !companiesWithCategories.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        filterChip("All", active: filterCompanyId == nil) {
                            filterCompanyId = nil
                        }
                        ForEach(companiesWithCategories) { company in
                            filterChip(company.code, active: filterCompanyId == company.id) {
                                filterCompanyId = company.id
                            }
                        }
                    }
                    .padding(.vertical, 4)
                    .padding(.horizontal, 2)
                }
                .listRowInsets(EdgeInsets(top: 2, leading: 8, bottom: 4, trailing: 8))
                .listRowBackground(Color.clear)
            }

            if displayedCategories.isEmpty {
                EmptyStateView(title: "No categories yet", systemImage: "tag")
            } else {
                ForEach(displayedCategories) { item in
                    Section {
                        categoryRow(item: item)
                    }
                }
            }
        }
        .compactListSections()
        .navigationTitle("Category")
        .searchable(text: $searchText, prompt: "Search categories")
        .tightSearchTopInset()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingAdd = true } label: { Image(systemName: "plus") }
                    .disabled(appState.companies.isEmpty)
            }
        }
        .sheet(isPresented: $showingAdd) {
            CategoryFormSheet(mode: .create)
        }
        .sheet(item: $editTarget) { item in
            CategoryFormSheet(mode: .edit(category: item.category, companyId: item.company.id))
        }
        .confirmationDialog(
            "Delete \"\(pendingDelete?.category.code ?? "")\"?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                if let item = pendingDelete { deleteCategory(item) }
                pendingDelete = nil
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        } message: {
            Text("This action cannot be undone.")
        }
    }

    @ViewBuilder
    private func categoryRow(item: CategoryWithContext) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(item.category.code)
                .font(.headline)
            Text(item.company.name)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if item.category.branchIds.isEmpty {
                Text("All branches")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            } else {
                let names = item.category.branchIds
                    .compactMap { id in item.company.branches.first { $0.id == id }?.name }
                    .joined(separator: ", ")
                if !names.isEmpty {
                    Label(names, systemImage: "building")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
                pendingDelete = item
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            Button {
                editTarget = item
            } label: {
                Label("Edit", systemImage: "pencil")
            }
            .tint(.blue)
        }
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

    private func deleteCategory(_ item: CategoryWithContext) {
        Task {
            try? await appState.deleteCategory(companyId: item.company.id, categoryId: item.category.id)
        }
    }
}

// MARK: - Category Form

private enum CategoryFormMode {
    case create
    case edit(category: Category, companyId: String)
}

private struct CategoryFormSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let mode: CategoryFormMode

    @State private var code = ""
    @State private var selectedCompanyId = ""
    @State private var selectedBranchIds: Set<String> = []
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var isEditing: Bool {
        if case .edit = mode { return true }
        return false
    }

    private var selectedCompany: Company? {
        appState.companies.first { $0.id == selectedCompanyId }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Category") {
                    TextField("Code (e.g. CAM)", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                }

                Section("Company") {
                    Picker("Company", selection: $selectedCompanyId) {
                        Text("Select a company").tag("")
                        ForEach(appState.companies) { company in
                            Text(company.name).tag(company.id)
                        }
                    }
                }

                if let company = selectedCompany, !company.branches.isEmpty {
                    Section("Branches (leave all off = all branches)") {
                        ForEach(company.branches) { branch in
                            Toggle(branch.name, isOn: Binding(
                                get: { selectedBranchIds.contains(branch.id) },
                                set: { on in
                                    if on { selectedBranchIds.insert(branch.id) }
                                    else { selectedBranchIds.remove(branch.id) }
                                }
                            ))
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle(isEditing ? "Edit Category" : "New Category")
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
                                code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                                selectedCompanyId.isEmpty
                            )
                    }
                }
            }
        }
        .onAppear { setupInitialState() }
        .onChange(of: selectedCompanyId) { _ in selectedBranchIds = [] }
        .interactiveDismissDisabled(isSubmitting)
    }

    private func setupInitialState() {
        switch mode {
        case .create:
            if appState.companies.count == 1 {
                selectedCompanyId = appState.companies[0].id
            }
        case .edit(let category, let companyId):
            code = category.code
            selectedCompanyId = companyId
            selectedBranchIds = Set(category.branchIds)
        }
    }

    private func submit() {
        let trimmedCode = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !trimmedCode.isEmpty, !selectedCompanyId.isEmpty else { return }
        isSubmitting = true
        let branchIds = Array(selectedBranchIds)
        Task {
            defer { isSubmitting = false }
            do {
                switch mode {
                case .create:
                    try await appState.createCategory(
                        companyId: selectedCompanyId,
                        code: trimmedCode,
                        branchIds: branchIds
                    )
                case .edit(let category, let companyId):
                    try await appState.updateCategory(
                        companyId: companyId,
                        categoryId: category.id,
                        code: trimmedCode,
                        branchIds: branchIds
                    )
                }
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
