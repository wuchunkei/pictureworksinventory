import SwiftUI

struct AppLockView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            VStack(spacing: 28) {
                Image(systemName: appState.biometricSystemImage)
                    .font(.system(size: 60))
                    .foregroundStyle(.blue)

                Text("Inventory is Locked")
                    .font(.title2.bold())

                Text("Authenticate to continue.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Button {
                    Task { await appState.unlockApp() }
                } label: {
                    Label("Unlock with \(appState.biometricLabel)", systemImage: appState.biometricSystemImage)
                        .frame(maxWidth: 280)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .padding(40)
        }
        .onAppear {
            Task { await appState.unlockApp() }
        }
    }
}
