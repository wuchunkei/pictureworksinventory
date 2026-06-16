import SwiftUI

/// Superadmin-only email (SMTP) alert configuration. Edits the server's
/// notificationSettings.smtp and can send a real test email.
struct SMTPSettingsView: View {
    @EnvironmentObject private var appState: AppState

    @State private var smtp = SMTPSettings()
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var isTesting = false
    @State private var loadError: String?
    @State private var message: String?
    @State private var messageIsError = false

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading…")
            } else if let loadError {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle").font(.largeTitle).foregroundStyle(.secondary)
                    Text(loadError).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }.padding()
            } else {
                form
            }
        }
        .navigationTitle("Email Alerts")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var form: some View {
        Form {
            Section {
                Toggle("Enable email alerts", isOn: $smtp.enabled)
            } footer: {
                Text("When on, daily stock-check and borrow/return/disposal approval notifications are also emailed to the relevant users (who have an email on file).")
            }

            Section("SMTP Server") {
                LabeledTextField(title: "Host", text: $smtp.host, placeholder: "smtp.example.com", keyboard: .URL)
                HStack {
                    Text("Port")
                    Spacer()
                    TextField("587", value: $smtp.port, format: .number)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 90)
                }
                Toggle("Use SSL (port 465)", isOn: $smtp.secure)
            }

            Section("Authentication") {
                LabeledTextField(title: "Username", text: $smtp.username, placeholder: "user@example.com", keyboard: .emailAddress)
                HStack {
                    Text("Password")
                    Spacer()
                    SecureField("••••••", text: $smtp.password)
                        .multilineTextAlignment(.trailing)
                }
            }

            Section("Sender") {
                LabeledTextField(title: "From name", text: $smtp.fromName, placeholder: "PictureWorks Inventory", keyboard: .default)
                LabeledTextField(title: "From email", text: $smtp.fromAddress, placeholder: "no-reply@example.com", keyboard: .emailAddress)
            }

            Section {
                Button {
                    Task { await save() }
                } label: {
                    HStack { Text("Save"); Spacer(); if isSaving { ProgressView() } }
                }
                .disabled(isSaving)
                Button {
                    Task { await test() }
                } label: {
                    HStack { Text("Send Test Email"); Spacer(); if isTesting { ProgressView() } }
                }
                .disabled(isTesting || smtp.host.isEmpty)
            } footer: {
                VStack(alignment: .leading, spacing: 4) {
                    if let h = smtp.health {
                        Label(h == "ok" ? "Last test: OK" : "Last test: failed",
                              systemImage: h == "ok" ? "checkmark.circle.fill" : "xmark.circle.fill")
                            .foregroundStyle(h == "ok" ? .green : .red)
                    }
                    if let message {
                        Text(message).foregroundStyle(messageIsError ? .red : .green)
                    }
                    Text("The test email is sent to your profile email.")
                }
                .font(.footnote)
            }
        }
    }

    private func load() async {
        do {
            smtp = try await appState.api.fetchNotificationSettings()
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    private func save() async {
        isSaving = true; message = nil
        defer { isSaving = false }
        do {
            smtp = try await appState.api.updateSMTPSettings(smtp)
            message = "Saved."; messageIsError = false
        } catch {
            message = error.localizedDescription; messageIsError = true
        }
    }

    private func test() async {
        isTesting = true; message = nil
        defer { isTesting = false }
        do {
            // Save first so the test uses the latest values.
            smtp = try await appState.api.updateSMTPSettings(smtp)
            let result = try await appState.api.testSMTP(to: nil)
            message = result
            messageIsError = result.localizedCaseInsensitiveContains("fail")
            smtp = try await appState.api.fetchNotificationSettings()
        } catch {
            message = error.localizedDescription; messageIsError = true
        }
    }
}

private struct LabeledTextField: View {
    let title: String
    @Binding var text: String
    var placeholder: String = ""
    var keyboard: UIKeyboardType = .default

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            TextField(placeholder, text: $text)
                .multilineTextAlignment(.trailing)
                .keyboardType(keyboard)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
    }
}
