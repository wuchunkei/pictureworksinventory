import SwiftUI

struct AppLockSettingsView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        Form {
            Section {
                Toggle("Require \(appState.biometricLabel)", isOn: $appState.appLockEnabled)
                    .disabled(!appState.biometricEnabled)

                if appState.appLockEnabled {
                    Picker("Lock after", selection: $appState.appLockDelay) {
                        ForEach(AppLockDelay.allCases) { delay in
                            Text(delay.title).tag(delay)
                        }
                    }
                }
            } footer: {
                if appState.appLockEnabled {
                    Text("Inventory will require \(appState.biometricLabel) when you return after the selected delay.")
                        .font(.footnote)
                }
            }
        }
        .navigationTitle("App Lock")
    }
}
