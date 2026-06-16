import SwiftUI
import CoreLocation

struct UserLogView: View {
    @EnvironmentObject private var appState: AppState
    @State private var filterType: String? = nil
    @State private var searchText = ""
    @State private var fetchError: String?
    /// Reverse-geocoded place name per log id (lat/lng → "District, City").
    @State private var geoPlaces: [String: String] = [:]
    @State private var showingDateFilter = false
    @State private var dateFilterEnabled = false
    @State private var startDate = Calendar.current.date(byAdding: .month, value: -1, to: Date()) ?? Date()
    @State private var endDate = Date()

    private var allTypes: [String] {
        Array(Set(appState.userLogs.map { $0.type })).sorted()
    }

    private var displayedLogs: [UserLog] {
        let sorted = appState.userLogs.sorted {
            ($0.createdAt ?? "") > ($1.createdAt ?? "")
        }
        var result = sorted
        if let type = filterType {
            result = result.filter { $0.type == type }
        }
        if dateFilterEnabled {
            let dayEnd = Calendar.current.date(byAdding: .day, value: 1, to: endDate) ?? endDate
            result = result.filter { log in
                guard let iso = log.createdAt, let date = parseISO(iso) else { return false }
                return date >= startDate && date < dayEnd
            }
        }
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return result }
        return result.filter { log in
            (log.actorName ?? "").lowercased().contains(q) ||
            (log.message ?? "").lowercased().contains(q) ||
            (log.ipAddress ?? "").lowercased().contains(q)
        }
    }

    var body: some View {
        List {
            if let error = fetchError {
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }

            if dateFilterEnabled {
                Section {
                    HStack {
                        Image(systemName: "calendar")
                            .foregroundStyle(.blue)
                        Text("\(fmtDate(startDate))  →  \(fmtDate(endDate))")
                            .font(.subheadline)
                        Spacer()
                        Button("Clear") { dateFilterEnabled = false }
                            .font(.subheadline)
                            .foregroundStyle(.red)
                    }
                    .listRowBackground(Color.blue.opacity(0.08))
                }
            }

            if !allTypes.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        filterChip("All", active: filterType == nil) { filterType = nil }
                        ForEach(allTypes, id: \.self) { type in
                            filterChip(typeLabel(type), active: filterType == type) {
                                filterType = type
                            }
                        }
                    }
                    .padding(.vertical, 4)
                    .padding(.horizontal, 2)
                }
                .listRowInsets(EdgeInsets(top: 2, leading: 8, bottom: 4, trailing: 8))
                .listRowBackground(Color.clear)
            }

            if displayedLogs.isEmpty && fetchError == nil {
                EmptyStateView(title: searchText.isEmpty ? "No logs" : "No results", systemImage: "text.page")
            } else {
                ForEach(displayedLogs) { log in
                    Section {
                        logRow(log)
                    }
                }
            }
        }
        .compactListSections()
        .refreshable {
            await load()
        }
        .navigationTitle("User Log")
        .searchable(text: $searchText, prompt: "Search by name or IP")
        .tightSearchTopInset()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingDateFilter = true } label: {
                    Label("Filter", systemImage: dateFilterEnabled ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                }
                .foregroundStyle(dateFilterEnabled ? .blue : .secondary)
            }
        }
        .sheet(isPresented: $showingDateFilter) {
            NavigationStack {
                Form {
                    Section("Date Range") {
                        DatePicker("From", selection: $startDate, displayedComponents: .date)
                        DatePicker("To",   selection: $endDate,   in: startDate..., displayedComponents: .date)
                    }
                    Section {
                        Button("Apply Filter") {
                            dateFilterEnabled = true
                            showingDateFilter = false
                        }
                        .frame(maxWidth: .infinity, alignment: .center)
                        .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                        if dateFilterEnabled {
                            Button("Clear Filter", role: .destructive) {
                                dateFilterEnabled = false
                                showingDateFilter = false
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
                        Button("Cancel") { showingDateFilter = false }
                    }
                }
            }
            .presentationDetents([.medium])
        }
        .task {
            await load()
        }
    }

    private func load() async {
        fetchError = nil
        do {
            try await appState.fetchUserLogs()
        } catch {
            fetchError = error.localizedDescription
        }
    }

    @ViewBuilder
    private func logRow(_ log: UserLog) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                typeBadge(log.type)
                if let name = log.actorName, !name.isEmpty {
                    Text(name)
                        .font(.headline)
                }
                Spacer()
                if let createdAt = log.createdAt {
                    let (d, t) = formatDateParts(createdAt)
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(d)
                        Text(t)
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                }
            }
            if let ip = log.ipAddress, !ip.isEmpty {
                HStack(spacing: 4) {
                    flagEmoji(for: appState.cachedCountry(for: ip))
                        .task(id: ip) {
                            await appState.resolveCountry(for: ip)
                        }
                    Text(ip)
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    if let loc = appState.cachedLocation(for: ip) {
                        Text("· \(locationLabel(loc))")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            if let geo = log.geo, let lat = geo.lat, let lng = geo.lng {
                HStack(spacing: 4) {
                    Image(systemName: "location.fill")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    if let place = geoPlaces[log.id] {
                        Text(place)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                    Link(coordString(lat, lng), destination: mapsURL(lat: lat, lng: lng))
                        .font(.caption)
                }
                .task(id: log.id) { await resolvePlace(lat: lat, lng: lng, key: log.id) }
            }
            if let msg = log.message, !msg.isEmpty {
                Text(msg)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Helpers

    /// "22.28150, 114.15770" — the raw GPS fix, shown as a tappable map link.
    private func coordString(_ lat: Double, _ lng: Double) -> String {
        String(format: "%.5f, %.5f", lat, lng)
    }

    /// Opens the exact pin in Apple Maps.
    private func mapsURL(lat: Double, lng: Double) -> URL {
        URL(string: "https://maps.apple.com/?ll=\(lat),\(lng)&q=\(lat),\(lng)")
            ?? URL(string: "https://maps.apple.com")!
    }

    /// On-device reverse geocoding (free, no API key) — turns the coordinate into
    /// a human-readable "District, City" once, cached per log id.
    private func resolvePlace(lat: Double, lng: Double, key: String) async {
        guard geoPlaces[key] == nil else { return }
        let placemarks = try? await CLGeocoder()
            .reverseGeocodeLocation(CLLocation(latitude: lat, longitude: lng))
        guard let p = placemarks?.first else { return }
        let parts = [p.subLocality ?? p.locality, p.administrativeArea ?? p.country]
            .compactMap { $0 }
        let label = parts.isEmpty ? (p.name ?? "") : parts.joined(separator: ", ")
        if !label.isEmpty { geoPlaces[key] = label }
    }

    private func typeLabel(_ type: String) -> String {
        switch type {
        case "login": return "Login"
        case "logout": return "Logout"
        case "login_failed": return "Failed Login"
        case "password_reset", "reset_password": return "Reset PW"
        case "password_change": return "Change PW"
        case "register": return "Register"
        case "borrow": return "Borrow"
        case "return": return "Return"
        case "repair": return "Repair"
        case "repaired": return "Repaired"
        case "sku_add": return "Add SKU"
        case "sku_edit": return "Edit SKU"
        case "sku_delete": return "Delete SKU"
        case "sku_transfer": return "Transfer"
        case "sku_disposal": return "Disposal"
        case "user_create": return "Create User"
        case "user_edit": return "Edit User"
        case "user_disable": return "Disable User"
        case "user_resume": return "Resume User"
        case "company_create": return "Create Company"
        case "company_edit": return "Edit Company"
        case "company_delete": return "Delete Company"
        default: return type.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private func typeColor(_ type: String) -> Color {
        switch type {
        case "login", "register": return .green
        case "logout": return .blue
        case "login_failed": return .red
        case "password_reset", "reset_password", "password_change": return .orange
        case "borrow": return .purple
        case "return", "repaired": return .teal
        case "repair": return .orange
        case "sku_disposal": return .red
        case "user_disable": return .red
        case "user_resume": return .green
        default: return .gray
        }
    }

    private func typeBadge(_ type: String) -> some View {
        let color = typeColor(type)
        return Text(typeLabel(type))
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private func locationLabel(_ loc: IPLocation) -> String {
        let en = Locale(identifier: "en_US")
        let countryName = en.localizedString(forRegionCode: loc.countryCode) ?? loc.countryCode
        var parts: [String] = []
        if let city = loc.city, !city.isEmpty, city != countryName {
            parts.append(city)
        }
        if let region = loc.region, !region.isEmpty, region != countryName, region != loc.city {
            parts.append(region)
        }
        parts.append(countryName)
        return parts.joined(separator: ", ")
    }

    @ViewBuilder
    private func flagEmoji(for countryCode: String?) -> some View {
        if let code = countryCode, code.count == 2 {
            let flag = code.uppercased().unicodeScalars.compactMap {
                UnicodeScalar(127397 + $0.value)
            }.map { String($0) }.joined()
            Text(flag)
                .font(.caption)
        } else {
            Text("🌐")
                .font(.caption)
        }
    }

    private func filterChip(_ label: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.subheadline.weight(active ? .semibold : .regular))
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(active ? Color.blue : Color(.systemGray5))
                .foregroundStyle(active ? Color.white : Color.primary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
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
