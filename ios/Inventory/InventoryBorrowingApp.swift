import SwiftUI
import UIKit

@main
struct InventoryBorrowingApp: App {
    @StateObject private var appState = AppState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .environment(\.locale, Locale(identifier: appState.language.localeIdentifier))
                .preferredColorScheme(appState.theme.colorScheme)
        }
        .onChange(of: scenePhase) { newPhase in
            if newPhase == .background {
                appState.appDidBackground()
            } else if newPhase == .active {
                appState.appDidForeground()
                if !appState.appLocked {
                    Task { await appState.extendSessionIfNeeded() }
                }
            }
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                #if STAGING
                HStack {
                    Spacer()
                    Text("STAGING  ·  \(appState.api.baseURL.host ?? "staging")")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.black)
                    Spacer()
                }
                .padding(.vertical, 3)
                .background(Color.yellow)
                #endif
                RootView()
            }
            if appState.appLocked && appState.phase == .signedIn {
                AppLockView()
                    .transition(.opacity)
            }
            // Persuasion nudge sits ABOVE the app lock — shown each launch/foreground
            // while location permission isn't granted.
            if appState.showLocationNudge {
                LocationNudgeView()
                    .transition(.opacity)
                    .zIndex(2)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: appState.appLocked)
        .animation(.easeInOut(duration: 0.2), value: appState.showLocationNudge)
    }
}

/// Shown over everything (including the app lock) on each launch/foreground while
/// location permission isn't granted — explains the benefits and offers to enable.
struct LocationNudgeView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
            VStack(spacing: 20) {
                Image(systemName: "location.fill.viewfinder")
                    .font(.system(size: 50))
                    .foregroundStyle(.blue)
                Text("Enable Location")
                    .font(.title2.bold())
                Text("Please allow location access. It lets the app pick the closest, fastest server, keeps you compliant with regional access rules, and records where each operation happens for security auditing. Your location is only used for these purposes.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                VStack(spacing: 10) {
                    Button {
                        if appState.geo.isUndetermined {
                            appState.geo.start()
                        } else if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Text("Enable Location").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    Button {
                        appState.showLocationNudge = false
                    } label: {
                        Text("Not now").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                }
                .padding(.top, 4)
            }
            .padding(28)
            .background(RoundedRectangle(cornerRadius: 20).fill(.background))
            .padding(32)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        Group {
            switch appState.phase {
            case .checking:
                ProgressView()
                    .controlSize(.large)
            case .signedOut:
                if appState.firstNodeChosen {
                    LoginView()
                } else {
                    ServerSelectView()
                }
            case .signedIn:
                MainTabView()
                    .sheet(isPresented: $appState.needsPasswordChange) {
                        ChangePasswordSheet(required: true)
                    }
                    .sheet(isPresented: $appState.showBiometricEnrollment) {
                        BiometricEnrollmentSheet()
                    }
            }
        }
    }
}
