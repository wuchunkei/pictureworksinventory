import SwiftUI
import UniformTypeIdentifiers
import UIKit

// MARK: - Document Picker

private struct StaffImportPicker: UIViewControllerRepresentable {
    let onPick: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick) }

    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let types: [UTType] = [
            UTType("org.openxmlformats.spreadsheetml.sheet"),
            UTType("com.microsoft.excel.xls"),
            UTType.spreadsheet,
            UTType.commaSeparatedText,
            UTType.plainText
        ].compactMap { $0 }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types)
        picker.delegate = context.coordinator
        picker.allowsMultipleSelection = false
        return picker
    }

    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}

    class Coordinator: NSObject, UIDocumentPickerDelegate {
        let onPick: (URL) -> Void
        init(onPick: @escaping (URL) -> Void) { self.onPick = onPick }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            onPick(url)
        }
    }
}

// MARK: - Users List

struct UsersListView: View {
    @EnvironmentObject private var appState: AppState
    @State private var showingAdd = false
    @State private var showingImport = false
    @State private var editTarget: User?
    @State private var pendingDisable: User?
    @State private var pendingResume: User?
    @State private var disableBlockedUser: User?
    @State private var pendingResetPassword: User?
    @State private var importError: String?
    @State private var actionError: String?
    @State private var filterRole: UserRole? = nil
    @State private var filterCompanyId: String? = nil
    @State private var searchText = ""
    @State private var staffImportDiff: StaffImportDiff?
    @State private var importing = false

    private var visibleUsers: [User] {
        guard let current = appState.currentUser else { return [] }
        return appState.users.filter { user in
            if user.id == current.id { return false }
            if current.role == .superadmin { return true }
            if current.role == .admin { return user.role != .superadmin }
            if current.role == .warehouseManager { return user.role == .staff }
            return false
        }.sorted { $0.name < $1.name }
    }

    private var displayedUsers: [User] {
        var result = filterRole == nil ? visibleUsers : visibleUsers.filter { $0.role == filterRole }
        if let cid = filterCompanyId {
            result = result.filter { ($0.warehouseIds ?? []).contains(cid) }
        }
        if !searchText.isEmpty {
            let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            result = result.filter {
                $0.name.lowercased().contains(q) ||
                $0.username.lowercased().contains(q) ||
                ($0.phone?.lowercased().contains(q) == true) ||
                ($0.email?.lowercased().contains(q) == true)
            }
        }
        return result
    }

    private var availableFilterRoles: [UserRole] {
        let rolesInList = Set(visibleUsers.map { $0.role })
        return [.staff, .warehouseManager, .admin, .superadmin].filter { rolesInList.contains($0) }
    }

    private var contentList: some View {
        List {
            if !availableFilterRoles.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        filterChip("All", active: filterRole == nil) { filterRole = nil }
                        ForEach(availableFilterRoles, id: \.self) { role in
                            filterChip(role.displayName, active: filterRole == role) {
                                filterRole = role
                            }
                        }
                    }
                    .padding(.vertical, 4)
                    .padding(.horizontal, 2)
                }
                .listRowInsets(EdgeInsets(top: 2, leading: 8, bottom: 4, trailing: 8))
                .listRowBackground(Color.clear)
            }
            // Company filter — works alongside the role filter (both must match).
            if !appState.companies.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        filterChip("All companies", active: filterCompanyId == nil) { filterCompanyId = nil }
                        ForEach(appState.companies) { company in
                            filterChip(company.name, active: filterCompanyId == company.id) {
                                filterCompanyId = company.id
                            }
                        }
                    }
                    .padding(.vertical, 4)
                    .padding(.horizontal, 2)
                }
                .listRowInsets(EdgeInsets(top: 0, leading: 8, bottom: 4, trailing: 8))
                .listRowBackground(Color.clear)
            }
            if displayedUsers.isEmpty {
                EmptyStateView(title: "No users", systemImage: "person.2")
            } else {
                ForEach(displayedUsers) { user in
                    Section { userRow(user) }
                }
            }
        }
        .compactListSections()
        .navigationTitle("Users")
        .searchable(text: $searchText, prompt: "Search by name or employee ID")
        .tightSearchTopInset()
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text("Users").font(.headline)
                    if let dir = appState.staffDirectory {
                        Text(daysSinceLabel(dir.importedAt))
                            .font(.caption2)
                            .foregroundStyle(daysSinceColor(dir.importedAt))
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingImport = true } label: {
                    Image(systemName: "square.and.arrow.down")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingAdd = true } label: {
                    Image(systemName: "plus")
                }
                .disabled(appState.permissions?.canManageUsers != true)
            }
        }
        .sheet(isPresented: $showingAdd) { UserFormSheet(mode: .create) }
        .sheet(item: $editTarget) { user in UserFormSheet(mode: .edit(user)) }
        .sheet(isPresented: $showingImport) {
            StaffImportPicker { url in
                showingImport = false
                importing = true
                Task {
                    defer { importing = false }
                    do {
                        let entries = try await appState.parseStaffEntries(from: url)
                        staffImportDiff = appState.diffStaffImport(entries)
                    } catch {
                        importError = error.localizedDescription
                    }
                }
            }
        }
        .sheet(item: Binding(get: { staffImportDiff.map { StaffDiffBox(diff: $0) } },
                             set: { if $0 == nil { staffImportDiff = nil } })) { box in
            StaffImportReviewSheet(diff: box.diff) { confirmedEntries in
                appState.applyStaffDirectory(confirmedEntries)
                staffImportDiff = nil
            }
        }
        .refreshable { try? await appState.refresh() }
    }

    var body: some View {
        contentList
        .confirmationDialog(
            "Disable \"\(pendingDisable?.name ?? "")\"?",
            isPresented: Binding(get: { pendingDisable != nil }, set: { if !$0 { pendingDisable = nil } }),
            titleVisibility: .visible
        ) {
            Button("Disable", role: .destructive) {
                if let u = pendingDisable { toggleDisable(u, disabled: true) }
                pendingDisable = nil
            }
            Button("Cancel", role: .cancel) { pendingDisable = nil }
        } message: {
            Text("The account will expire after 30 days of being disabled.")
        }
        .confirmationDialog(
            "Resume \"\(pendingResume?.name ?? "")\"?",
            isPresented: Binding(get: { pendingResume != nil }, set: { if !$0 { pendingResume = nil } }),
            titleVisibility: .visible
        ) {
            Button("Resume") {
                if let u = pendingResume { toggleDisable(u, disabled: false) }
                pendingResume = nil
            }
            Button("Cancel", role: .cancel) { pendingResume = nil }
        } message: {
            Text("This will reactivate the account.")
        }
        .confirmationDialog(
            "Reset Password for \"\(pendingResetPassword?.name ?? "")\"?",
            isPresented: Binding(get: { pendingResetPassword != nil }, set: { if !$0 { pendingResetPassword = nil } }),
            titleVisibility: .visible
        ) {
            Button("Reset Password", role: .destructive) {
                if let u = pendingResetPassword { resetPassword(u) }
                pendingResetPassword = nil
            }
            Button("Cancel", role: .cancel) { pendingResetPassword = nil }
        } message: {
            Text("The user's password will be cleared and they will be required to set a new password on next login.")
        }
        .alert(
            "Cannot Disable \"\(disableBlockedUser?.name ?? "")\"",
            isPresented: Binding(get: { disableBlockedUser != nil }, set: { if !$0 { disableBlockedUser = nil } })
        ) {
            Button("OK", role: .cancel) { disableBlockedUser = nil }
        } message: {
            Text("This user still has borrowed items. Ask them to return all items before disabling the account.")
        }
        .alert("Import Failed", isPresented: Binding(get: { importError != nil }, set: { if !$0 { importError = nil } })) {
            Button("OK", role: .cancel) { importError = nil }
        } message: {
            Text(importError ?? "")
        }
        .alert("Error", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: {
            Text(actionError ?? "")
        }
    }

    @ViewBuilder
    private func userRow(_ user: User) -> some View {
        let expired = isExpired(user)
        let disabled = user.isDisabled == true

        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(user.name)
                    .font(.headline)
                    .foregroundStyle(disabled ? .secondary : .primary)
                roleBadge(user.role)
                if expired {
                    statusTag("Expired", color: .red)
                } else if disabled {
                    statusTag("Disabled", color: .secondary)
                }
            }
            Text(user.username)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if let phone = user.phone, !phone.isEmpty {
                let cc = user.phoneCountryCode ?? ""
                Text(cc.isEmpty ? phone : "\(cc) \(phone)")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if disabled {
                Button {
                    pendingResume = user
                } label: {
                    Label("Resume", systemImage: "person.badge.plus")
                }
                .tint(.green)
            } else {
                Button(role: .destructive) {
                    if appState.skus.contains(where: { $0.status == .borrowed && $0.borrowedByUserId == user.id }) {
                        disableBlockedUser = user
                    } else {
                        pendingDisable = user
                    }
                } label: {
                    Label("Disable", systemImage: "person.slash")
                }
                Button {
                    pendingResetPassword = user
                } label: {
                    Label("Reset Password", systemImage: "key.fill")
                }
                .tint(.orange)
            }
        }
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            if !disabled {
                Button {
                    editTarget = user
                } label: {
                    Label("Edit", systemImage: "pencil")
                }
                .tint(.blue)
            }
        }
    }

    // MARK: - Helpers

    private func isExpired(_ user: User) -> Bool {
        guard user.isDisabled == true else { return false }
        let dateStr = user.disabledAt ?? user.updatedAt ?? ""
        let parser = ISO8601DateFormatter()
        guard let date = parser.date(from: dateStr) else { return false }
        let days = Calendar.current.dateComponents([.day], from: date, to: Date()).day ?? 0
        return days >= 30
    }

    private func toggleDisable(_ user: User, disabled: Bool) {
        Task {
            do {
                if disabled {
                    try await appState.disableUser(id: user.id)
                } else {
                    try await appState.resumeUser(id: user.id)
                }
            } catch {
                actionError = error.localizedDescription
            }
        }
    }

    private func resetPassword(_ user: User) {
        Task {
            do {
                try await appState.resetPasswordRequired(id: user.id)
            } catch {
                actionError = error.localizedDescription
            }
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

    private func roleColor(_ role: UserRole) -> Color {
        switch role {
        case .staff: return .green
        case .warehouseManager: return .blue
        case .admin: return .orange
        case .superadmin: return .red
        }
    }

    private func roleBadge(_ role: UserRole) -> some View {
        let color = roleColor(role)
        return Text(role.displayName)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private func statusTag(_ label: String, color: Color) -> some View {
        Text(label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.12))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private func daysSinceLabel(_ date: Date) -> String {
        let days = Calendar.current.dateComponents([.day], from: date, to: Date()).day ?? 0
        if days == 0 { return "Updated today" }
        if days == 1 { return "Updated 1 day ago" }
        return "Updated \(days) days ago"
    }

    private func daysSinceColor(_ date: Date) -> Color {
        let days = Calendar.current.dateComponents([.day], from: date, to: Date()).day ?? 0
        if days < 5 { return .green }
        if days <= 7 { return Color.yellow }
        return .red
    }
}

// MARK: - User Form

private enum UserFormMode {
    case create
    case edit(User)
}

private struct UserFormSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let mode: UserFormMode

    @State private var username = ""
    @State private var name = ""
    @State private var password = ""
    @State private var selectedRole: UserRole = .staff
    @State private var phone = ""
    @State private var phoneCountryCode = "+86"
    @State private var email = ""
    @State private var isDisabled = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var directoryMatched = false
    @State private var companyIds: Set<String> = []
    @State private var branchIds: Set<String> = []

    private var isEditing: Bool {
        if case .edit = mode { return true }
        return false
    }

    private var availableRoles: [UserRole] {
        guard let current = appState.currentUser else { return [.staff] }
        switch current.role {
        case .superadmin:
            return [.staff, .warehouseManager, .admin, .superadmin]
        case .admin:
            return [.staff, .warehouseManager]
        default:
            return [.staff]
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if !isEditing {
                    Section {
                        TextField("Employee ID", text: $username)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        TextField("Display name", text: $name)
                        if !directoryMatched && !name.trimmingCharacters(in: .whitespaces).isEmpty {
                            let suggestions = appState.staffSuggestions(for: name)
                            ForEach(suggestions) { entry in
                                Button {
                                    name = entry.name
                                } label: {
                                    HStack {
                                        Image(systemName: "person.text.rectangle")
                                            .foregroundStyle(.secondary)
                                        Text(entry.name)
                                        Spacer()
                                        if let p = entry.phone, !p.isEmpty {
                                            Text(p).font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                .foregroundStyle(.primary)
                            }
                        }
                    } header: {
                        Text("Account")
                    } footer: {
                        VStack(alignment: .leading, spacing: 4) {
                            if directoryMatched {
                                Label("Matched from staff directory", systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                            } else if appState.staffDirectory == nil {
                                Label("Import a staff directory (xlsx/CSV) first — users must match a directory entry.", systemImage: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.orange)
                            } else if !name.trimmingCharacters(in: .whitespaces).isEmpty {
                                Label("This name is not in the staff directory. Pick a suggestion to continue.", systemImage: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.orange)
                            }
                            Text("No password needed — the user sets their own on first login after verifying their name and phone.")
                        }
                        .font(.caption)
                    }

                    Section("Contact") {
                        PhoneField(digits: $phone, countryCode: $phoneCountryCode)
                        TextField("Email", text: $email)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.emailAddress)
                    }
                } else {
                    Section("Profile") {
                        TextField("Display name", text: $name)
                        PhoneField(digits: $phone, countryCode: $phoneCountryCode)
                        TextField("Email", text: $email)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.emailAddress)
                    }
                }

                Section("Role") {
                    Picker("Role", selection: $selectedRole) {
                        ForEach(availableRoles, id: \.self) { role in
                            Text(role.displayName).tag(role)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                // Company scope (warehouseIds). Superadmin/admin see everything,
                // so the picker only applies to other roles.
                if selectedRole != .superadmin && !appState.companies.isEmpty {
                    Section {
                        ForEach(appState.companies) { company in
                            Button {
                                if companyIds.contains(company.id) {
                                    companyIds.remove(company.id)
                                    for b in company.branches { branchIds.remove(b.id) }   // drop its branch picks
                                } else { companyIds.insert(company.id) }
                            } label: {
                                HStack {
                                    Text(company.name).foregroundStyle(.primary)
                                    Spacer()
                                    if companyIds.contains(company.id) {
                                        Image(systemName: "checkmark").foregroundStyle(.blue)
                                    }
                                }
                            }
                            // When the company is selected, optionally narrow to
                            // specific branches. None checked = whole company.
                            if companyIds.contains(company.id) {
                                ForEach(company.branches) { branch in
                                    Button {
                                        if branchIds.contains(branch.id) { branchIds.remove(branch.id) }
                                        else { branchIds.insert(branch.id) }
                                    } label: {
                                        HStack {
                                            Text(branch.name).font(.subheadline).foregroundStyle(.secondary)
                                                .padding(.leading, 16)
                                            Spacer()
                                            if branchIds.contains(branch.id) {
                                                Image(systemName: "checkmark").foregroundStyle(.blue).font(.caption)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } header: {
                        Text("Companies (access scope)")
                    } footer: {
                        Text("Which companies this user can access. Optionally check specific branches — no branch checked means the whole company.")
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
            .navigationTitle(isEditing ? "Edit User" : "New User")
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
                            .disabled(!canSubmit)
                    }
                }
            }
        }
        .onAppear { setupInitialState() }
        .onChange(of: name) { newName in
            guard !isEditing else { return }
            if let entry = appState.lookupStaffEntry(name: newName) {
                // Overwrite contact fields from the matched entry — including
                // clearing them when the new entry has no phone/email, so a
                // previously-selected person's data never lingers.
                if let p = entry.phone, !p.isEmpty {
                    applyDirectoryPhone(p)
                } else {
                    phoneCountryCode = "+86"
                    phone = ""
                }
                email = entry.email ?? ""
                directoryMatched = true
            } else {
                directoryMatched = false
            }
        }
        .interactiveDismissDisabled(isSubmitting)
    }

    /// Fills the phone field from a directory value, detecting a leading
    /// country code (e.g. "+85290141873") or defaulting to +86.
    private func applyDirectoryPhone(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("+") {
            let codes = CountryCode.all.map { $0.code }.sorted { $0.count > $1.count }
            if let code = codes.first(where: { trimmed.hasPrefix($0) }) {
                phoneCountryCode = code
                phone = String(trimmed.dropFirst(code.count)).filter { $0.isNumber }
                return
            }
        }
        phoneCountryCode = "+86"
        phone = trimmed.filter { $0.isNumber }
    }

    private var canSubmit: Bool {
        let nameOK = !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if isEditing { return nameOK }
        // New users must match an entry in the staff directory (name + phone).
        return nameOK &&
            !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            directoryMatched
    }

    private func setupInitialState() {
        if case .edit(let user) = mode {
            name = user.name
            selectedRole = user.role
            phone = user.phone ?? ""
            phoneCountryCode = user.phoneCountryCode ?? "+86"
            email = user.email ?? ""
            isDisabled = user.isDisabled ?? false
            companyIds = Set(user.warehouseIds ?? [])
            branchIds = Set(user.branchIds ?? [])
        }
        if !availableRoles.contains(selectedRole) {
            selectedRole = availableRoles.first ?? .staff
        }
    }

    private func submit() {
        guard canSubmit else { return }
        let trimmedName  = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPhone = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)

        if let phoneError = validatePhone(digits: trimmedPhone, countryCode: phoneCountryCode) {
            errorMessage = phoneError; return
        }
        if let emailError = validateEmail(trimmedEmail) {
            errorMessage = emailError; return
        }

        let phoneArg: String? = trimmedPhone.isEmpty ? nil : trimmedPhone
        let ccArg: String? = phoneArg != nil ? phoneCountryCode : nil
        // Superadmin/admin always see everything → no scoping stored.
        let isAll = (selectedRole == .superadmin)
        let whIds: [String] = isAll ? [] : Array(companyIds)
        // Keep only branches that belong to a selected company.
        let validBranchIds: [String] = isAll ? [] : appState.companies
            .filter { companyIds.contains($0.id) }
            .flatMap { $0.branches.map { $0.id } }
            .filter { branchIds.contains($0) }

        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                switch mode {
                case .create:
                    let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
                    try await appState.createUser(
                        username: trimmedUsername,
                        name: trimmedName,
                        password: password,
                        role: selectedRole.rawValue,
                        phone: phoneArg,
                        phoneCountryCode: ccArg,
                        email: trimmedEmail.isEmpty ? nil : trimmedEmail,
                        warehouseIds: whIds,
                        branchIds: validBranchIds
                    )
                case .edit(let user):
                    try await appState.updateUser(
                        id: user.id,
                        name: trimmedName,
                        role: selectedRole.rawValue,
                        phone: phoneArg,
                        phoneCountryCode: ccArg,
                        email: trimmedEmail.isEmpty ? nil : trimmedEmail,
                        isDisabled: isDisabled,
                        warehouseIds: whIds,
                        branchIds: validBranchIds
                    )
                }
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Staff Import Review

/// Identifiable wrapper so the diff can drive a `.sheet(item:)`.
struct StaffDiffBox: Identifiable {
    let diff: StaffImportDiff
    let id = UUID()
}

/// Shows the staff-directory import comparison (new / updated / unchanged) and
/// asks before replacing the directory.
private struct StaffImportReviewSheet: View {
    @Environment(\.dismiss) private var dismiss
    let diff: StaffImportDiff
    let onConfirm: ([StaffEntry]) -> Void

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 16) {
                        stat("New", diff.added.count, .green)
                        stat("Updated", diff.updated.count, .orange)
                        stat("Unchanged", diff.unchanged.count, .secondary)
                    }
                }
                if !diff.added.isEmpty {
                    Section("New people (\(diff.added.count))") {
                        ForEach(diff.added) { e in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(e.name).font(.subheadline.weight(.semibold))
                                Text([e.phone, e.email].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                if !diff.updated.isEmpty {
                    Section("Updated info (\(diff.updated.count))") {
                        ForEach(diff.updated) { c in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.new.name).font(.subheadline.weight(.semibold))
                                if (c.old.phone ?? "") != (c.new.phone ?? "") {
                                    Text("Phone: \(c.old.phone ?? "—") → \(c.new.phone ?? "—")").font(.caption).foregroundStyle(.secondary)
                                }
                                if (c.old.email ?? "") != (c.new.email ?? "") {
                                    Text("Email: \(c.old.email ?? "—") → \(c.new.email ?? "—")").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                if diff.added.isEmpty && diff.updated.isEmpty {
                    Section { Text("No new people or changes — the directory is already up to date.").foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Review Import")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Update") { onConfirm(diff.all); dismiss() }
                }
            }
        }
    }

    private func stat(_ label: String, _ n: Int, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(n)").font(.title3.bold()).foregroundStyle(color)
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}
