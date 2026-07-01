import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            connectionBar
            TabView {
                HomeView()
                    .tabItem { Label("Home", systemImage: "house") }

                SearchView()
                    .tabItem { Label("Search", systemImage: "magnifyingglass") }

                if appState.canReceiveNotifications {
                    NotificationsView()
                        .tabItem { Label("Notify", systemImage: "bell") }
                        .badge(appState.notificationBadgeCount > 0 ? appState.notificationBadgeCount : 0)
                }

                StatusView()
                    .tabItem { Label("Status", systemImage: "shippingbox") }
                    .badge(appState.borrowedItems.count > 0 ? appState.borrowedItems.count : 0)

                MeView()
                    .tabItem { Label("Me", systemImage: "person.crop.circle") }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: appState.connectionState)
        .sheet(isPresented: $appState.showNodePickerSheet) {
            ServerNodePickerSheet()
        }
    }

    @ViewBuilder
    private var connectionBar: some View {
        switch appState.connectionState {
        case .connecting:
            HStack(spacing: 8) {
                ProgressView().controlSize(.mini)
                Text("Connecting…")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(.thinMaterial)
        case .lost:
            Button {
                appState.showNodePickerSheet = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "wifi.exclamationmark")
                    Text("Lost connection — tap to choose a server node")
                        .font(.footnote.weight(.semibold))
                    Spacer(minLength: 0)
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 9)
                .frame(maxWidth: .infinity)
                .background(Color.red)
            }
            .buttonStyle(.plain)
        case .connected:
            EmptyView()
        }
    }
}
