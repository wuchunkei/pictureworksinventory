import SwiftUI
import LocalAuthentication

private enum LoginStep {
    case employee
    case password
    case register
    case resetPasswordVerify   // Step 1: verify identity (employee ID readonly + name + phone)
    case resetPassword         // Step 2: set new password (after verification)
    case itContact
}

private enum ITRegion: String, CaseIterable, Identifiable {
    case china = "China"
    case hongKong = "Hong Kong"
    case macao = "Macao"

    var id: String { rawValue }
}

private enum ChinaITContact: String, CaseIterable, Identifiable {
    case mark = "Mark"
    case john = "John"

    var id: String { rawValue }
}

private struct ITContact {
    let name: String
    let email: String
    let phone: String

    var mailURL: URL {
        URL(string: "mailto:\(email)")!
    }

    var phoneURL: URL {
        let digits = phone.filter { $0.isNumber || $0 == "+" }
        return URL(string: "tel:\(digits)")!
    }
}

struct LoginView: View {
    @EnvironmentObject private var appState: AppState
    @State private var step: LoginStep = .employee
    @State private var username = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var phone = ""
    @State private var phoneCountryCode = "+86"
    @State private var nameInput = ""
    @State private var displayName = ""
    @State private var isSubmitting = false
    @State private var selectedRegion: ITRegion = .hongKong
    @State private var selectedChinaContact: ChinaITContact = .mark
    @State private var showingBiometricUnavailableAlert = false
    @State private var showingVersionAlert = false
    @State private var biometricFailures = 0
    @FocusState private var focusedField: Field?
    private let fieldHeight: CGFloat = 44

    private var canUseBiometric: Bool {
        biometricFailures < 2 &&
        appState.biometricLoginAvailable
    }

    private enum Field {
        case username
        case password
        case confirmPassword
        case phone
        case name
    }

    var body: some View {
        NavigationStack {
            ZStack {
                background
                if step == .itContact {
                    ITContactView(
                        selectedRegion: $selectedRegion,
                        selectedChinaContact: $selectedChinaContact
                    ) {
                        appState.errorMessage = nil
                        step = .employee
                        focusedField = .username
                    }
                    .padding(.horizontal, 22)
                } else {
                    GeometryReader { proxy in
                        ZStack(alignment: .top) {
                            VStack(spacing: 18) {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Inventory")
                                        .font(.largeTitle.bold())
                                        .contentShape(Rectangle())
                                        .onTapGesture { showingVersionAlert = true }
                                    Text(subtitle)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)

                                VStack(spacing: 14) {
                                    credentialFields

                                    HStack(spacing: 12) {
                                        Button(action: submit) {
                                            Group {
                                                if isSubmitting {
                                                    ProgressView()
                                                } else {
                                                    Text(primaryButtonTitle)
                                                }
                                            }
                                            .frame(maxWidth: .infinity, minHeight: fieldHeight - 8)
                                        }
                                        .buttonStyle(.borderedProminent)
                                        .disabled(isSubmitting || !canSubmitCurrentStep)

                                        if step == .employee && appState.hasBiometricHardware {
                                            biometricButton
                                        }
                                    }
                                }
                                .animation(.easeInOut(duration: 0.16), value: step)

                                secondaryControls
                            }
                            .padding(.horizontal, 22)
                            .frame(maxWidth: .infinity)
                            .position(x: proxy.size.width / 2, y: loginStackCenterY(for: proxy.size.height))

                            if let message = appState.errorMessage {
                                errorMessageView(message)
                                    .padding(.horizontal, 22)
                                    .position(x: proxy.size.width / 2, y: loginErrorY(for: proxy.size.height))
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .top) {
                ServerNodePicker(showsLabel: false)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 6)
            }
            .onAppear {
                focusedField = .username
                if canUseBiometric && !appState.didJustLogout {
                    triggerBiometric()
                }
                appState.didJustLogout = false
            }
            .alert("Inventory", isPresented: $showingVersionAlert) {
                Button("OK", role: .cancel) { }
            } message: {
                Text("Version \(AppInfo.fullVersion)")
            }
        }
    }

    private var background: some View {
        LinearGradient(
            colors: [Color(.systemBackground), Color(.secondarySystemBackground)],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
        .contentShape(Rectangle())
        .onTapGesture { focusedField = nil }   // tap empty space to dismiss the keyboard
    }

    private var title: String {
        switch step {
        case .employee: return "Inventory"
        case .password: return "Log in"
        case .register: return "Register"
        case .resetPasswordVerify: return "Reset Password"
        case .resetPassword: return "Reset Password"
        case .itContact: return "IT Contact Information"
        }
    }

    private var subtitle: String {
        switch step {
        case .employee:
            return "Enter your employee ID to continue."
        case .password:
            return "Welcome back, \(displayName.isEmpty ? username : displayName)!"
        case .register:
            return "Verify your phone and set a password."
        case .resetPasswordVerify:
            return "Verify your identity to reset your password."
        case .resetPassword:
            return "Identity verified. Set your new password."
        case .itContact:
            return "Please contact IT."
        }
    }

    private var primaryButtonTitle: String {
        switch step {
        case .employee: return "Next"
        case .password: return "Log in"
        case .register: return "Register"
        case .resetPasswordVerify: return "Verify"
        case .resetPassword: return "Reset Password"
        case .itContact: return "Back to login."
        }
    }

    private func loginStackCenterY(for height: CGFloat) -> CGFloat {
        min(max(height * 0.39, 300), 380)
    }

    private func loginErrorY(for height: CGFloat) -> CGFloat {
        loginStackCenterY(for: height) + 152
    }

    private var canSubmitCurrentStep: Bool {
        switch step {
        case .employee:
            return !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .resetPasswordVerify:
            return !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && !nameInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && !phone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        default:
            return !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    @ViewBuilder
    private var credentialFields: some View {
        switch step {
        case .employee:
            employeeField
        case .password:
            SecureField("Password", text: $password)
                .textContentType(.password)
                .focused($focusedField, equals: .password)
                .submitLabel(.go)
                .onSubmit { submit() }
                .inventoryTextFieldStyle()
        case .register:
            employeeField
            SecureField("Password", text: $password)
                .textContentType(.newPassword)
                .focused($focusedField, equals: .password)
                .inventoryTextFieldStyle()
            SecureField("Confirm password", text: $confirmPassword)
                .textContentType(.newPassword)
                .focused($focusedField, equals: .confirmPassword)
                .inventoryTextFieldStyle()
            PhoneField(digits: $phone, countryCode: $phoneCountryCode)
                .inventoryTextFieldStyle()
        case .resetPasswordVerify:
            employeeField
            TextField("Full name", text: $nameInput)
                .textInputAutocapitalization(.words)
                .focused($focusedField, equals: .name)
                .inventoryTextFieldStyle()
            PhoneField(digits: $phone, countryCode: $phoneCountryCode)
                .inventoryTextFieldStyle()
        case .resetPassword:
            SecureField("New password", text: $password)
                .textContentType(.newPassword)
                .focused($focusedField, equals: .password)
                .inventoryTextFieldStyle()
            SecureField("Confirm password", text: $confirmPassword)
                .textContentType(.newPassword)
                .focused($focusedField, equals: .confirmPassword)
                .inventoryTextFieldStyle()
        case .itContact:
            EmptyView()
        }
    }

    private var employeeField: some View {
        TextField("Employee ID", text: $username)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .textContentType(.username)
            .focused($focusedField, equals: .username)
            .disabled(step != .employee)
            .inventoryTextFieldStyle(height: fieldHeight, isReadOnly: step != .employee)
    }

    @ViewBuilder
    private var secondaryControls: some View {
        ZStack {
            if step == .employee {
                forgotPasswordButton
                    .frame(maxWidth: .infinity, alignment: .center)
                    .transition(.opacity.combined(with: .move(edge: .trailing)))
            } else if step == .password {
                HStack {
                    wrongAccountButton
                    Spacer()
                    forgotPasswordButton
                }
                .transition(.opacity)
            } else {
                wrongAccountButton
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
        .frame(height: 24)
        .animation(.easeInOut(duration: 0.22), value: step)
    }

    @ViewBuilder
    private func errorMessageView(_ message: String) -> some View {
        if message == "Please contact IT." {
            Button("Wrong employee ID, click here to contact IT") {
                appState.errorMessage = nil
                selectedRegion = .hongKong
                selectedChinaContact = .mark
                step = .itContact
            }
            .font(.footnote)
            .buttonStyle(.plain)
            .foregroundStyle(.blue)
            .frame(maxWidth: .infinity, alignment: .center)
        } else {
            Text(message)
                .font(.footnote)
                .foregroundStyle(.red)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private var biometricButton: some View {
        Button {
            if canUseBiometric {
                triggerBiometric()
            } else {
                showingBiometricUnavailableAlert = true
            }
        } label: {
            Image(systemName: appState.biometricSystemImage)
                .font(.title3.weight(.medium))
                .frame(width: 44, height: fieldHeight - 8)
        }
        .buttonStyle(.borderedProminent)
        .tint(canUseBiometric ? .blue : Color(.systemGray4))
        .disabled(isSubmitting)
        .alert("Not available", isPresented: $showingBiometricUnavailableAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            if biometricFailures >= 2 {
                Text("Too many failed attempts. Please log in with your employee ID and password.")
            } else {
                Text("Please log in with your employee ID and password first.")
            }
        }
    }

    private func triggerBiometric() {
        Task {
            let success = await appState.loginWithBiometric()
            if !success {
                biometricFailures += 1
            }
        }
    }

    private var forgotPasswordButton: some View {
        Button("Forgot Password >") {
            let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedUsername.isEmpty else {
                appState.errorMessage = "Enter your employee ID first."
                focusedField = .username
                return
            }
            appState.errorMessage = nil
            username = trimmedUsername
            password = ""
            confirmPassword = ""
            nameInput = ""
            phone = ""; phoneCountryCode = "+86"
            step = .resetPasswordVerify
            focusedField = .name
            Task { try? await appState.api.forgotPassword(username: trimmedUsername) }
        }
        .buttonStyle(.plain)
        .foregroundStyle(.red)
    }

    private var wrongAccountButton: some View {
        Button {
            appState.errorMessage = nil
            password = ""
            confirmPassword = ""
            nameInput = ""
            phone = ""; phoneCountryCode = "+86"
            step = .employee
            focusedField = .username
        } label: {
            HStack(spacing: 4) {
                Text("<")
                Text("Wrong Account")
            }
        }
        .buttonStyle(.borderless)
    }

    private func submit() {
        guard !isSubmitting else { return }
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            switch step {
            case .employee:
                do {
                    let response = try await appState.api.loginStart(username: username.trimmingCharacters(in: .whitespacesAndNewlines))
                    displayName = response.user?.name ?? ""
                    if !response.exists {
                        appState.errorMessage = "Please contact IT."
                    } else if response.hasPassword && !response.resetRequired {
                        appState.errorMessage = nil
                        step = .password
                        focusedField = .password
                    } else {
                        appState.errorMessage = nil
                        step = response.resetRequired ? .resetPasswordVerify : .register
                        focusedField = response.resetRequired ? .name : .password
                    }
                } catch {
                    appState.errorMessage = error.localizedDescription
                }
            case .password:
                await appState.login(username: username, password: password)
            case .register:
                let trimmedPhone = phone.trimmingCharacters(in: .whitespacesAndNewlines)
                if let phoneError = validatePhone(digits: trimmedPhone, countryCode: phoneCountryCode) {
                    appState.errorMessage = phoneError
                    isSubmitting = false
                    return
                }
                await appState.register(username: username, password: password, confirmPassword: confirmPassword, phone: trimmedPhone, phoneCountryCode: phoneCountryCode)
            case .resetPasswordVerify:
                do {
                    try await appState.verifyIdentity(
                        username: username,
                        name: nameInput.trimmingCharacters(in: .whitespacesAndNewlines),
                        phone: phone.trimmingCharacters(in: .whitespacesAndNewlines)
                    )
                    appState.errorMessage = nil
                    step = .resetPassword
                    focusedField = .password
                } catch {
                    appState.errorMessage = error.localizedDescription
                }
            case .resetPassword:
                await appState.resetPassword(
                    username: username,
                    newPassword: password,
                    confirmPassword: confirmPassword,
                    phone: phone.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            case .itContact:
                break
            }
        }
    }
}

private struct ITContactView: View {
    @Binding var selectedRegion: ITRegion
    @Binding var selectedChinaContact: ChinaITContact
    let onBack: () -> Void

    private var contact: ITContact {
        switch selectedRegion {
        case .hongKong, .macao:
            return ITContact(name: "John Hu", email: "john.hu@pictureworks.com", phone: "+852 5262 9698")
        case .china:
            switch selectedChinaContact {
            case .mark:
                return ITContact(name: "Mark Gao", email: "mark.gao@pictureworks.com", phone: "+86 136 6100 8218")
            case .john:
                return ITContact(name: "John Hu", email: "john.hu@pictureworks.com", phone: "+852 5262 9698")
            }
        }
    }

    var body: some View {
        VStack {
            Spacer()
            VStack(spacing: 18) {
                Text("IT Contact Information")
                    .font(.title2.bold())
                    .multilineTextAlignment(.center)

                Picker("Region", selection: $selectedRegion) {
                    ForEach(ITRegion.allCases) { region in
                        Text(region.rawValue).tag(region)
                    }
                }
                .pickerStyle(.segmented)

                if selectedRegion == .china {
                    Picker("Contact", selection: $selectedChinaContact) {
                        ForEach(ChinaITContact.allCases) { contact in
                            Text(contact.rawValue).tag(contact)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text(contact.name)
                        .font(.headline)
                    Link("Email: \(contact.email)", destination: contact.mailURL)
                    Link("Phone: \(contact.phone)", destination: contact.phoneURL)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)

                Button("Back to login.") {
                    onBack()
                }
                .buttonStyle(.plain)
                .foregroundStyle(.blue)
                .padding(.top, 2)
            }
            .padding(22)
            .frame(maxWidth: 430)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            Spacer()
        }
    }
}

private extension View {
    func inventoryTextFieldStyle(height: CGFloat = 44, isReadOnly: Bool = false) -> some View {
        self
            .padding(.horizontal, 2)
            .frame(height: height)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(isReadOnly ? Color.secondary.opacity(0.22) : Color.secondary.opacity(0.42))
                    .frame(height: 1)
            }
    }
}

/// First-launch (before login) server-node picker. Choose "Recommended" to
/// auto-use the fastest node on every launch, or pin a specific node.
struct ServerSelectView: View {
    @EnvironmentObject private var appState: AppState

    private func latencyText(_ label: String) -> String {
        if let entry = appState.nodeLatencies[label] {
            if let ms = entry { return "\(ms) ms" }
            return "超時"
        }
        return appState.isMeasuringNodes ? "…" : ""
    }

    private var recommended: ServerNodeInfo? {
        let selectable = appState.serverNodes.filter { appState.nodeSelectable($0) }
        func lat(_ n: ServerNodeInfo) -> Int { (appState.nodeLatencies[n.label] ?? nil) ?? Int.max }
        let measured = selectable.filter { (appState.nodeLatencies[$0.label] ?? nil) != nil }
        if let best = measured.min(by: { lat($0) < lat($1) }) { return best }
        return selectable.first
    }

    private var regionSections: [(String, [ServerNodeInfo])] {
        let grouped = Dictionary(grouping: appState.serverNodes) { appState.nodeRegion($0.label) }
        var ordered = AppState.nodeRegionOrder.compactMap { region -> (String, [ServerNodeInfo])? in
            guard let nodes = grouped[region], !nodes.isEmpty else { return nil }
            return (region, nodes)
        }
        for (region, nodes) in grouped where !AppState.nodeRegionOrder.contains(region) {
            ordered.append((region, nodes))
        }
        return ordered
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("选择服务器").font(.largeTitle.bold())
                Text("首次使用，请先选择一个服务器节点。选择「推荐」后每次都会自动使用最快的节点；选择具体节点则会固定使用它。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                if let rec = recommended {
                    Button { appState.chooseRecommended() } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "bolt.fill")
                            VStack(alignment: .leading, spacing: 2) {
                                Text("推荐（自动选择最快）").fontWeight(.semibold)
                                Text("\(rec.label)  \(latencyText(rec.label))").font(.caption)
                            }
                            Spacer()
                        }
                        .padding()
                        .frame(maxWidth: .infinity)
                        .background(Color.blue, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                }

                ForEach(regionSections, id: \.0) { region, nodes in
                    Text(region)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding(.top, 6)
                    ForEach(nodes) { node in
                        Button { appState.chooseSpecificNode(node.label) } label: {
                            HStack {
                                Text(node.label)
                                Spacer()
                                Text(latencyText(node.label))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            .contentShape(Rectangle())
                            .padding(.vertical, 10)
                        }
                        .buttonStyle(.plain)
                        Divider()
                    }
                }
            }
            .padding(22)
        }
        .task { await appState.measureNodeLatencies() }
    }
}
