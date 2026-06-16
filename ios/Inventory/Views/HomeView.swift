import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        NavigationStack {
            List {
                if let user = appState.currentUser {
                    Section {
                        GlassPanel {
                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(user.name)
                                            .font(.title3.bold())
                                        Text(user.role.displayName)
                                            .font(.subheadline)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "person.text.rectangle")
                                        .font(.title2)
                                        .foregroundStyle(.secondary)
                                }
                                HStack(spacing: 12) {
                                    metric(title: "Borrowed", value: "\(appState.borrowedItems.count)")
                                    metric(title: "Available", value: "\(appState.skus.filter { $0.status == .available }.count)")
                                    metric(title: "Repairing", value: "\(appState.skus.filter { $0.status == .repairing }.count)")
                                }
                            }
                        }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                    }
                }

                Section("Work") {
                    NavigationLink {
                        RecentActivityView()
                    } label: {
                        Label("Recent activity", systemImage: "clock")
                    }
                    if appState.currentUser?.role.canSeeManagementShortcuts == true {
                        NavigationLink {
                            InventoryListView()
                        } label: {
                            Label("Inventory", systemImage: "list.bullet.rectangle")
                        }
                        NavigationLink {
                            CompanyListView()
                        } label: {
                            Label("Company", systemImage: "building.2")
                        }
                        NavigationLink {
                            CategoryListView()
                        } label: {
                            Label("Category", systemImage: "tag")
                        }
                        NavigationLink {
                            RecordsListView()
                        } label: {
                            Label("Records", systemImage: "doc.text.magnifyingglass")
                        }
                        NavigationLink {
                            UsersListView()
                        } label: {
                            Label("Users", systemImage: "person.2")
                        }
                    }
                    if appState.permissions?.canViewUserLogs == true {
                        NavigationLink {
                            UserLogView()
                        } label: {
                            Label("User Log", systemImage: "text.page")
                        }
                    }
                }
            }
            .navigationTitle("Home")
            .refreshable {
                try? await appState.refresh()
            }
        }
    }

    private func metric(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(.title3.bold())
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct RecentActivityView: View {
    @EnvironmentObject private var appState: AppState
    @State private var showingFilter = false
    @State private var filterEnabled = false
    @State private var startDate = Calendar.current.date(byAdding: .month, value: -1, to: Date()) ?? Date()
    @State private var endDate = Date()

    private var filteredRecords: [InventoryRecord] {
        guard filterEnabled else { return Array(appState.records.prefix(100)) }
        let dayEnd = Calendar.current.date(byAdding: .day, value: 1, to: endDate) ?? endDate
        return appState.records.filter { record in
            guard let iso = record.createdAt, let date = parseISO(iso) else { return false }
            return date >= startDate && date < dayEnd
        }
    }

    var body: some View {
        List {
            if filterEnabled {
                Section {
                    HStack {
                        Image(systemName: "calendar")
                            .foregroundStyle(.blue)
                        Text("\(fmtDate(startDate))  →  \(fmtDate(endDate))")
                            .font(.subheadline)
                        Spacer()
                        Button("Clear") { filterEnabled = false }
                            .font(.subheadline)
                            .foregroundStyle(.red)
                    }
                    .listRowBackground(Color.blue.opacity(0.08))
                }
            }
            if filteredRecords.isEmpty {
                EmptyStateView(title: filterEnabled ? "No activity in range" : "No recent activity", systemImage: "clock")
            } else {
                ForEach(filteredRecords) { record in
                    HStack(alignment: .top, spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text((record.type == "return_after_repair" ? "REPAIRED" : record.type).uppercased())
                                .font(.headline.weight(.bold))
                                .foregroundStyle(.primary)
                            Text(record.skuCode ?? "")
                                .font(.subheadline)
                        }
                        Spacer()
                        if let createdAt = record.createdAt {
                            let (d, t) = formatDateParts(createdAt)
                            VStack(alignment: .trailing, spacing: 1) {
                                Text(d)
                                Text(t)
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .navigationTitle("Recent activity")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingFilter = true } label: {
                    Label("Filter", systemImage: filterEnabled ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }
                .foregroundStyle(filterEnabled ? .blue : .secondary)
            }
        }
        .sheet(isPresented: $showingFilter) {
            NavigationStack {
                Form {
                    Section("Date Range") {
                        DatePicker("From", selection: $startDate, displayedComponents: .date)
                        DatePicker("To",   selection: $endDate,   in: startDate..., displayedComponents: .date)
                    }
                    Section {
                        Button("Apply Filter") {
                            filterEnabled = true
                            showingFilter = false
                        }
                        .frame(maxWidth: .infinity, alignment: .center)
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                        if filterEnabled {
                            Button("Clear Filter", role: .destructive) {
                                filterEnabled = false
                                showingFilter = false
                            }
                            .frame(maxWidth: .infinity, alignment: .center)
                            .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                        }
                    }
                }
                .navigationTitle("Filter by Date")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { showingFilter = false }
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    private func parseISO(_ iso: String) -> Date? {
        let p = ISO8601DateFormatter()
        p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = p.date(from: iso) { return d }
        p.formatOptions = [.withInternetDateTime]
        return p.date(from: iso)
    }

    private func fmtDate(_ date: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    private func formatDateParts(_ iso: String) -> (String, String) {
        guard let date = parseISO(iso) else { return (iso, "") }
        let d = DateFormatter(); d.locale = Locale(identifier: "en_US_POSIX"); d.dateFormat = "yyyy-MM-dd"
        let t = DateFormatter(); t.locale = Locale(identifier: "en_US_POSIX"); t.dateFormat = "HH:mm:ss"
        return (d.string(from: date), t.string(from: date))
    }
}

struct PlaceholderFeatureView: View {
    var title: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "hammer")
                .font(.system(size: 36, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.title3.bold())
            Text("This native module is reserved for the next iOS build pass.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .navigationTitle(title)
    }
}
