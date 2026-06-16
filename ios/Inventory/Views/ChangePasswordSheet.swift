import SwiftUI

struct ChangePasswordSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let required: Bool

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var canSubmit: Bool {
        !currentPassword.isEmpty && newPassword.count >= 8 && newPassword == confirmPassword
    }

    var body: some View {
        NavigationStack {
            Form {
                if required {
                    Section {
                        Label("Your password has expired. You must set a new password to continue.", systemImage: "lock.rotation")
                            .font(.subheadline)
                            .foregroundStyle(.orange)
                    }
                }

                Section("Current Password") {
                    SecureField("Current password", text: $currentPassword)
                }

                Section("New Password") {
                    SecureField("New password (min 8 characters)", text: $newPassword)
                    SecureField("Confirm new password", text: $confirmPassword)
                }

                if let error = errorMessage {
                    Section {
                        Text(error).foregroundStyle(.red).font(.footnote)
                    }
                }
            }
            .navigationTitle("Change Password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !required {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                            .disabled(isSubmitting)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Save") { submit() }.disabled(!canSubmit)
                    }
                }
            }
            .interactiveDismissDisabled(required || isSubmitting)
        }
    }

    private func submit() {
        isSubmitting = true
        errorMessage = nil
        Task {
            defer { isSubmitting = false }
            do {
                try await appState.changePassword(
                    currentPassword: currentPassword,
                    newPassword: newPassword,
                    confirmPassword: confirmPassword
                )
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
