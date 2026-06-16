import SwiftUI

struct BiometricEnrollmentSheet: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Image(systemName: "faceid")
                .font(.system(size: 64))
                .foregroundStyle(.blue)
            VStack(spacing: 10) {
                Text("Enable FaceID / TouchID")
                    .font(.title2.bold())
                Text("Use biometrics for faster login and an extended session.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            VStack(spacing: 12) {
                Button {
                    Task { await appState.enrollBiometric() }
                } label: {
                    Text("Enable")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(.horizontal, 32)

                Button {
                    appState.skipBiometricEnrollment()
                } label: {
                    Text("Not Now")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .padding(.horizontal, 32)
            }
            Spacer()
        }
        .interactiveDismissDisabled()
    }
}
