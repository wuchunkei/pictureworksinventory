import SwiftUI

struct RecordsListView: View {
    @EnvironmentObject private var appState: AppState
    @State private var searchText = ""

    private var filteredRecords: [InventoryRecord] {
        let sorted = appState.records.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return sorted }
        return sorted.filter { record in
            nameFor(record.userId ?? "").lowercased().contains(q) ||
            nameFor(record.operatorId ?? "").lowercased().contains(q) ||
            (record.skuCode ?? "").lowercased().contains(q)
        }
    }

    var body: some View {
        List {
            if filteredRecords.isEmpty {
                EmptyStateView(title: searchText.isEmpty ? "No records" : "No results", systemImage: "doc.text.magnifyingglass")
            } else {
                ForEach(filteredRecords) { record in
                    recordRow(record)
                }
            }
        }
        .navigationTitle("Records")
        .searchable(text: $searchText, prompt: "Search by name or SKU")
        .refreshable {
            try? await appState.refresh()
        }
    }

    @ViewBuilder
    private func recordRow(_ record: InventoryRecord) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                typeBadge(record.type)
                Spacer()
                if let date = record.createdAt {
                    let (d, t) = formatDateParts(date)
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(d)
                        Text(t)
                    }
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
                }
            }
            if let skuCode = record.skuCode, !skuCode.isEmpty {
                Text(skuCode)
                    .font(.subheadline.monospaced())
                    .foregroundStyle(.primary)
            }
            HStack(spacing: 16) {
                if let userId = record.userId {
                    infoLabel("User", value: nameFor(userId))
                }
                if let opId = record.operatorId, opId != record.userId {
                    infoLabel("By", value: nameFor(opId))
                }
                if let note = record.note, !note.isEmpty {
                    infoLabel("Note", value: note)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func typeBadge(_ type: String) -> some View {
        let (label, color) = typeInfo(type)
        return Text(label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.15))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private func typeInfo(_ type: String) -> (String, Color) {
        switch type {
        case "borrow":              return ("Borrow",   .blue)
        case "return":              return ("Return",   .green)
        case "repair":              return ("Repair",   .orange)
        case "return_after_repair": return ("Repaired", .teal)
        case "transfer":            return ("Transfer", .purple)
        case "disposal":            return ("Disposal", .red)
        case "add":                 return ("Added",    .gray)
        default:                    return (type.capitalized, .secondary)
        }
    }

    private func nameFor(_ id: String) -> String {
        guard !id.isEmpty else { return "" }
        return appState.users.first { $0.id == id }?.name ?? id
    }

    private func formatDateParts(_ iso: String) -> (String, String) {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = parser.date(from: iso)
        if date == nil {
            parser.formatOptions = [.withInternetDateTime]
            date = parser.date(from: iso)
        }
        guard let date else { return (iso, "") }
        let d = DateFormatter(); d.locale = Locale(identifier: "en_US_POSIX"); d.dateFormat = "yyyy-MM-dd"
        let t = DateFormatter(); t.locale = Locale(identifier: "en_US_POSIX"); t.dateFormat = "HH:mm:ss"
        return (d.string(from: date), t.string(from: date))
    }

    private func infoLabel(_ key: String, value: String) -> some View {
        HStack(spacing: 2) {
            Text(key + ":")
                .font(.caption)
                .foregroundStyle(.tertiary)
            Text(value)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
