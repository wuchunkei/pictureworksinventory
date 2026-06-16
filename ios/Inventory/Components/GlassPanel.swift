import SwiftUI
import Foundation

struct GlassPanel<Content: View>: View {
    var content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(16)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

struct StatusPill: View {
    var status: SKUStatus

    var body: some View {
        Text(status.displayName)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(color.opacity(0.16), in: Capsule())
            .foregroundStyle(color)
    }

    private var color: Color {
        switch status {
        case .available: return .green
        case .borrowed: return .blue
        case .repairing: return .orange
        case .disposed, .sold: return .red
        }
    }
}

struct SKUCard: View {
    var item: SKUItem

    private var skuCodeColor: Color {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let rawString = item.lastScannedAt ?? item.createdAt
        guard let raw = rawString, let ref = formatter.date(from: raw) else { return .primary }
        let cal = Calendar.current
        let now = Date()
        if let twoAgo = cal.date(byAdding: .month, value: -2, to: now), ref < twoAgo { return .red }
        if let oneAgo = cal.date(byAdding: .month, value: -1, to: now), ref < oneAgo { return .orange }
        return .primary
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.displayCode)
                    .font(.headline)
                    .foregroundStyle(skuCodeColor)
                Spacer(minLength: 12)
                StatusPill(status: item.status)
            }
            if let serial = item.serialNumber, !serial.isEmpty {
                Label(serial, systemImage: "barcode.viewfinder")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if let description = item.descriptionText, !description.isEmpty {
                Text(description)
                    .font(.subheadline)
            }
            HStack {
                if let park = item.parkName, !park.isEmpty {
                    Label(park, systemImage: "mappin.and.ellipse")
                }
                if item.status == .repairing, let name = item.repairRequestedByName, !name.isEmpty {
                    Label(name, systemImage: "person")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

extension View {
    @ViewBuilder
    func compactListSections() -> some View {
        if #available(iOS 17.0, *) {
            self.listSectionSpacing(8)
        } else {
            self
        }
    }
}

struct EmptyStateView: View {
    var title: String
    var systemImage: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 36, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
    }
}
