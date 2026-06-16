import SwiftUI

struct MeView: View {
    @EnvironmentObject private var appState: AppState
    @State private var showingLogoutConfirm = false

    var body: some View {
        NavigationStack {
            List {
                if let user = appState.currentUser {
                    Section {
                        NavigationLink {
                            ProfileView()
                        } label: {
                            HStack(spacing: 14) {
                                Image(systemName: "person.crop.circle.fill")
                                    .font(.largeTitle)
                                    .foregroundStyle(.blue)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(user.name)
                                        .font(.headline)
                                    Text("\(user.username) · \(user.role.displayName)")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 8)
                        }
                    }
                }

                Section {
                    NavigationLink {
                        SettingsView()
                    } label: {
                        Label("Settings", systemImage: "gear")
                    }
                    NavigationLink {
                        BluetoothView()
                    } label: {
                        Label("Bluetooth", systemImage: "dot.radiowaves.left.and.right")
                    }
                    if appState.currentUser?.role == .superadmin {
                        NavigationLink {
                            SMTPSettingsView()
                        } label: {
                            Label("Email Alerts", systemImage: "envelope.badge")
                        }
                    }
                }

                Section {
                    Button(role: .destructive) {
                        showingLogoutConfirm = true
                    } label: {
                        Label("Log Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
            .navigationTitle("Me")
            .confirmationDialog("Are you sure you want to log out?", isPresented: $showingLogoutConfirm) {
                Button("Log Out", role: .destructive) { appState.logout() }
                Button("Cancel", role: .cancel) {}
            }
        }
    }
}

struct ProfileView: View {
    @EnvironmentObject private var appState: AppState
    @State private var showingChangePassword = false

    var body: some View {
        List {
            if let user = appState.currentUser {
                Section {
                    profileRow("Name", value: user.name)
                    profileRow("Employee ID", value: user.username)
                    profileRow("Role", value: user.role.displayName)
                    if let phone = user.phone, !phone.isEmpty {
                        profileRow("Phone", value: phone)
                    }
                    if let email = user.email, !email.isEmpty {
                        profileRow("Email", value: email)
                    }
                }
            }

            Section {
                Button("Change Password") {
                    showingChangePassword = true
                }
            }
        }
        .navigationTitle("Profile")
        .sheet(isPresented: $showingChangePassword) {
            ChangePasswordSheet(required: false)
        }
    }

    private func profileRow(_ title: String, value: String) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .multilineTextAlignment(.trailing)
        }
    }
}
