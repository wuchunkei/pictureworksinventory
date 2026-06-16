import SwiftUI
import CoreLocation
import UIKit

/// Settings row showing the current location-permission status, with a tap to
/// enable (OS dialog if undecided, otherwise deep-link to system Settings).
struct LocationSettingsRow: View {
    @EnvironmentObject private var appState: AppState

    private var statusText: String {
        switch appState.geo.status {
        case .authorizedWhenInUse, .authorizedAlways: return "Allowed"
        case .denied, .restricted: return "Off — tap to enable"
        default: return "Not set"
        }
    }

    var body: some View {
        Button {
            if appState.geo.isUndetermined {
                appState.geo.start()
            } else if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
        } label: {
            HStack {
                Text("Location").foregroundStyle(.primary)
                Spacer()
                Text(statusText)
                    .font(.subheadline)
                    .foregroundStyle(appState.geo.isAuthorized ? Color.secondary : Color.orange)
            }
        }
    }
}

/// App version info, read from the bundle (Info.plist).
enum AppInfo {
    /// Marketing version, e.g. "v0.1".
    static var shortVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        return "v\(v)"
    }
    /// Marketing version + build number, e.g. "v0.1 (1)".
    static var fullVersion: String {
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        return "\(shortVersion) (\(b))"
    }
}

/// Server-node selector, shared by Settings and the login screen. Styled like
/// the country-code picker: a button showing only the current node's name, which
/// opens a sheet with "Recommended" (the single lowest-latency node) and "All
/// Nodes" sections. Picking the fastest node returns to auto mode; picking any
/// other node pins to it (see `AppState.selectServerNode`).
struct ServerNodePicker: View {
    @EnvironmentObject private var appState: AppState
    var showsLabel: Bool = true
    @State private var showingSheet = false

    var body: some View {
        Button { showingSheet = true } label: {
            if showsLabel {
                HStack {
                    Text("Server Node").foregroundStyle(.primary)
                    Spacer()
                    Text(currentName).foregroundStyle(.secondary)
                    chevron
                }
            } else {
                HStack(spacing: 4) {
                    Text(currentName).foregroundStyle(.primary)
                    chevron
                }
            }
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showingSheet) {
            ServerNodePickerSheet()
        }
    }

    private var currentName: String {
        appState.selectedNodeLabel.isEmpty ? "—" : appState.selectedNodeLabel
    }

    private var chevron: some View {
        Image(systemName: "chevron.up.chevron.down")
            .font(.caption2)
            .foregroundStyle(.secondary)
    }
}

/// The node-selection sheet (mirrors `CountryPickerSheet`).
struct ServerNodePickerSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var showRestrictionAlert = false
    @State private var showOfflineAlert = false

    /// Always surface a recommendation: the lowest-latency reachable+selectable
    /// node, or — if none have a measured latency yet — the first selectable node.
    /// This guarantees a "Recommended" entry regardless of how many nodes there are.
    private var recommendedNode: ServerNodeInfo? {
        let selectable = appState.serverNodes.filter { appState.nodeSelectable($0) }
        let reachable = selectable.filter { !isOffline($0) }
        func latency(_ n: ServerNodeInfo) -> Int { (appState.nodeLatencies[n.label] ?? nil) ?? Int.max }
        let measured = reachable.filter { (appState.nodeLatencies[$0.label] ?? nil) != nil }
        if let best = measured.min(by: { latency($0) < latency($1) }) { return best }
        return reachable.first ?? selectable.first
    }

    /// Measured but unreachable (latency probe timed out) = offline.
    private func isOffline(_ node: ServerNodeInfo) -> Bool {
        if let entry = appState.nodeLatencies[node.label] { return entry == nil }
        return false
    }

    /// Nodes grouped into ordered (region, nodes) sections for the picker.
    private var regionSections: [(String, [ServerNodeInfo])] {
        let grouped = Dictionary(grouping: appState.serverNodes) { appState.nodeRegion($0.label) }
        var ordered = AppState.nodeRegionOrder.compactMap { region -> (String, [ServerNodeInfo])? in
            guard let nodes = grouped[region], !nodes.isEmpty else { return nil }
            return (region, nodes)
        }
        // Any region not in the canonical order (e.g. "Staging") appended at the end.
        for (region, nodes) in grouped where !AppState.nodeRegionOrder.contains(region) {
            ordered.append((region, nodes))
        }
        return ordered
    }

    var body: some View {
        NavigationStack {
            List {
                if let rec = recommendedNode {
                    Section("Recommended") {
                        row(rec)
                    }
                }
                // All nodes grouped by country/region.
                ForEach(regionSections, id: \.0) { region, nodes in
                    Section(region) {
                        ForEach(nodes) { node in
                            row(node)
                        }
                    }
                }
            }
            .navigationTitle("Server Node")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task { await appState.measureNodeLatencies() }
            .alert("This node can't be selected due to regional protection regulations.", isPresented: $showRestrictionAlert) {
                Button("OK", role: .cancel) {}
            }
            .alert("This node is unreachable right now.", isPresented: $showOfflineAlert) {
                Button("OK", role: .cancel) {}
            }
        }
    }

    private func row(_ node: ServerNodeInfo) -> some View {
        let regionOk = appState.nodeSelectable(node)
        let offline = isOffline(node)
        let enabled = regionOk && !offline
        return Button {
            if !regionOk {
                showRestrictionAlert = true
            } else if offline {
                showOfflineAlert = true
            } else {
                appState.selectServerNode(node.label)
                dismiss()
            }
        } label: {
            HStack {
                Text(node.label)
                if !regionOk {
                    Image(systemName: "lock.fill")
                        .foregroundStyle(.secondary)
                        .font(.caption)
                }
                Spacer()
                Text(latencyText(node))
                    .foregroundStyle(offline ? .orange : .secondary)
                    .font(.subheadline)
                if appState.selectedNodeLabel == node.label {
                    Image(systemName: "checkmark")
                        .foregroundStyle(.blue)
                        .font(.subheadline)
                }
            }
            .foregroundStyle(enabled ? .primary : .secondary)
        }
    }

    private func latencyText(_ node: ServerNodeInfo) -> String {
        if let entry = appState.nodeLatencies[node.label] {
            if let ms = entry { return "\(ms) ms" }
            return "超時"
        }
        return appState.isMeasuringNodes ? "…" : ""
    }
}

struct SettingsView: View {
    @EnvironmentObject private var appState: AppState
    @State private var apiBaseURL = APIClient.defaultBaseURL().absoluteString
    @State private var cacheSize: Int64 = 0
    @State private var cleared = false

    var body: some View {
        Form {
            Section {
                Picker("Language", selection: $appState.language) {
                    ForEach(LanguageOption.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
                Picker("Theme", selection: $appState.theme) {
                    ForEach(ThemeOption.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }

                ServerNodePicker()

                LocationSettingsRow()

                if appState.currentUser?.role == .superadmin {
                    NavigationLink("Ping Alerts") {
                        PingAlertsView()
                    }
                }

                Toggle("Notifications", isOn: notificationBinding)

                if appState.hasBiometricHardware {
                    Toggle(appState.biometricLabel, isOn: biometricToggleBinding)
                    if appState.biometricEnabled {
                        NavigationLink("App Lock") {
                            AppLockSettingsView()
                        }
                    }
                }
            }

            Section("Storage") {
                Button {
                    appState.clearCache()
                    cleared = true
                    cacheSize = 0
                } label: {
                    HStack {
                        Text("Clear Cache")
                        Spacer()
                        Text(cleared ? "Cleared" : formattedSize)
                            .font(.subheadline)
                            .foregroundStyle(cleared ? .green : (cacheSize > 0 ? .red : .secondary))
                    }
                }
                .foregroundStyle(.primary)
            }

            #if DEBUG
            Section("Development") {
                TextField("API base URL", text: $apiBaseURL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("Apply API URL") {
                    appState.updateAPIBaseURL(apiBaseURL)
                }
            }
            #endif

            Section {
            } footer: {
                Text(AppInfo.fullVersion)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            apiBaseURL = appState.api.baseURL.absoluteString
            cleared = false
            cacheSize = appState.cacheSize
            Task { await appState.refreshNotificationPermissionState() }
        }
    }

    private var formattedSize: String {
        let f = ByteCountFormatter()
        f.allowedUnits = [.useKB, .useMB]
        f.countStyle = .file
        return f.string(fromByteCount: cacheSize)
    }

    private var biometricToggleBinding: Binding<Bool> {
        Binding {
            appState.biometricEnabled
        } set: { enabled in
            if enabled {
                Task { await appState.enrollBiometric() }
            } else {
                appState.biometricEnabled = false
                appState.appLockEnabled = false
            }
        }
    }

    private var notificationBinding: Binding<Bool> {
        Binding {
            appState.notificationsEnabled
        } set: { enabled in
            if enabled {
                Task { await appState.requestNotificationPermission() }
            } else {
                appState.notificationsEnabled = false
            }
        }
    }
}
