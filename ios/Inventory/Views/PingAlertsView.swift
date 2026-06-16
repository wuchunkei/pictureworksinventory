import SwiftUI

/// Superadmin screen: live TCP ping to every backend node (with a manual Test),
/// plus the list of recipients emailed when a node goes down / recovers. Only
/// superadmins who have an email on record can be recipients.
struct PingAlertsView: View {
    @EnvironmentObject private var appState: AppState
    @State private var showAddRecipient = false
    @State private var errorMessage: String?

    private var recipients: [User] {
        appState.pingAlertRecipientIds.compactMap { id in appState.users.first { $0.id == id } }
    }

    private var eligibleSuperadmins: [User] {
        appState.users.filter {
            $0.role == .superadmin &&
            !($0.email ?? "").trimmingCharacters(in: .whitespaces).isEmpty &&
            !appState.pingAlertRecipientIds.contains($0.id)
        }.sorted { $0.name < $1.name }
    }

    var body: some View {
        List {
            Section {
                ForEach(appState.serverNodes) { node in
                    HStack {
                        Text(node.label)
                        Spacer()
                        Text(latencyText(node))
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(latencyColor(node))
                    }
                }
            } header: {
                HStack {
                    Text("Server Ping (TCP)")
                    Spacer()
                    Button {
                        Task { await appState.measureNodeLatencies() }
                    } label: {
                        if appState.isMeasuringNodes {
                            ProgressView().controlSize(.mini)
                        } else {
                            Label("Test", systemImage: "bolt.horizontal.circle")
                        }
                    }
                    .disabled(appState.isMeasuringNodes)
                    .textCase(nil)
                }
            } footer: {
                Text("Every backend node is pinged every 5 minutes. If a node goes down — or recovers — the recipients below are emailed.")
            }

            Section {
                if recipients.isEmpty {
                    Text("No recipients yet.").foregroundStyle(.secondary)
                } else {
                    ForEach(recipients) { u in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(u.name)
                            Text(u.email ?? "").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .onDelete(perform: removeRecipients)
                }
                Button {
                    showAddRecipient = true
                } label: {
                    Label("Add recipient", systemImage: "plus.circle")
                }
                .disabled(eligibleSuperadmins.isEmpty)
            } header: {
                Text("Alert Recipients")
            } footer: {
                Text("Only superadmins with an email on file can be added.")
            }

            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red).font(.footnote) }
            }
        }
        .navigationTitle("Ping Alerts")
        .navigationBarTitleDisplayMode(.inline)
        .task { await appState.measureNodeLatencies() }
        .sheet(isPresented: $showAddRecipient) {
            NavigationStack {
                List(eligibleSuperadmins) { u in
                    Button {
                        add(u)
                        showAddRecipient = false
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(u.name).foregroundStyle(.primary)
                            Text(u.email ?? "").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .navigationTitle("Add Recipient")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { showAddRecipient = false }
                    }
                }
                .overlay {
                    if eligibleSuperadmins.isEmpty {
                        Text("No eligible superadmins (need an email on file).")
                            .foregroundStyle(.secondary).padding()
                    }
                }
            }
        }
    }

    // MARK: Actions

    private func add(_ u: User) {
        save(ids: appState.pingAlertRecipientIds + [u.id])
    }

    private func removeRecipients(at offsets: IndexSet) {
        let removeIds = Set(offsets.map { recipients[$0].id })
        save(ids: appState.pingAlertRecipientIds.filter { !removeIds.contains($0) })
    }

    private func save(ids: [String]) {
        Task {
            do { try await appState.updatePingAlerts(recipientUserIds: ids) }
            catch { errorMessage = (error as? APIClientError)?.errorDescription ?? error.localizedDescription }
        }
    }

    // MARK: Latency display

    private func latencyText(_ node: ServerNodeInfo) -> String {
        if let entry = appState.nodeLatencies[node.label] {
            if let ms = entry { return "\(ms) ms" }
            return "超時"
        }
        return appState.isMeasuringNodes ? "…" : "—"
    }

    private func latencyColor(_ node: ServerNodeInfo) -> Color {
        if let entry = appState.nodeLatencies[node.label] {
            return entry == nil ? .orange : .secondary
        }
        return .secondary
    }
}
