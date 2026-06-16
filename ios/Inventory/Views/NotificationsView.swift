import SwiftUI
import PencilKit

struct NotificationsView: View {
    @EnvironmentObject private var appState: AppState
    @State private var pendingApproval: NotificationItem?
    @State private var pendingDenial: NotificationItem?
    @State private var pendingAcfSign: NotificationItem?
    @State private var pendingAcfDeny: NotificationItem?
    @State private var resubmitTarget: NotificationItem?
    @State private var sharePayload: SharePayload?
    @State private var downloadingId: String?
    @State private var errorMessage: String?
    @State private var toast: String?

    private var canReview: Bool {
        appState.permissions?.canReviewApprovals == true
    }

    /// The current user is the endorser (recipient) of an unresolved sign request.
    private func isEndorserRequest(_ n: NotificationItem) -> Bool {
        n.type == "acf_sign_request" && n.status == "unread" && amRecipient(n)
    }

    var body: some View {
        NavigationStack {
            List {
                if appState.notifications.isEmpty {
                    EmptyStateView(title: "No notifications", systemImage: "bell.slash")
                } else {
                    ForEach(sortedNotifications) { notification in
                        Section {
                            if notification.type == "unscanned_check" {
                                NavigationLink {
                                    UnscannedItemsDetailView(notification: notification)
                                } label: {
                                    notificationRow(notification)
                                }
                                .contentShape(Rectangle())
                                .onAppear {
                                    if notification.status == "unread" {
                                        Task { await appState.markNotificationRead(notification) }
                                    }
                                }
                            } else {
                                notificationRow(notification)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Notifications")
            .refreshable {
                try? await appState.refresh()
            }
            .confirmationDialog(
                "Approve this request?",
                isPresented: Binding(get: { pendingApproval != nil }, set: { if !$0 { pendingApproval = nil } }),
                titleVisibility: .visible
            ) {
                Button("Approve") {
                    if let n = pendingApproval { approve(n) }
                    pendingApproval = nil
                }
                Button("Cancel", role: .cancel) { pendingApproval = nil }
            } message: {
                Text(pendingApproval?.body ?? "")
            }
            .sheet(item: $pendingDenial) { notification in
                DenySheet(notification: notification)
            }
            .sheet(item: $pendingAcfSign) { notification in
                ACFSignSheet(notification: notification)
            }
            .sheet(item: $pendingAcfDeny) { notification in
                ACFDenySheet(notification: notification)
            }
            .background(
                NavigationLink(
                    isActive: Binding(
                        get: { resubmitTarget != nil },
                        set: { if !$0 { resubmitTarget = nil } }
                    )
                ) {
                    if let t = resubmitTarget { ACFResubmitDetailView(notification: t) }
                } label: { EmptyView() }
                .opacity(0)
            )
            .sheet(item: $sharePayload) { payload in
                ShareSheet(url: payload.url)
            }
            .alert("Error", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "")
            }
            .overlay(alignment: .bottom) {
                if let toast {
                    Text(toast)
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.bottom, 40)
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: toast)
        }
    }

    private var isACF: (NotificationItem) -> Bool {
        { ($0.type).hasPrefix("acf_") }
    }

    private func amRecipient(_ n: NotificationItem) -> Bool {
        guard let me = appState.currentUser?.id else { return false }
        return n.recipientUserIds?.contains(me) ?? false
    }

    @ViewBuilder
    private func notificationRow(_ notification: NotificationItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(notification.title)
                    .font(.headline)
                Spacer()
                statusIndicator(notification)
            }

            if notification.type == "acf_completed", let meta = notification.acf {
                acfCompletedBody(meta)
            } else {
                Text(notification.body)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if let createdAt = notification.createdAt {
                let (d, t) = formatDateParts(createdAt)
                if isACF(notification) {
                    Text("\(d) \(t)")                    // ACF: single-line timestamp
                        .font(.caption2).foregroundStyle(.tertiary).monospacedDigit()
                } else {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(d); Text(t)
                    }
                    .font(.caption2).foregroundStyle(.tertiary).monospacedDigit()
                }
            }

            if notification.status == "pending" && canReview {
                actionButtons(primary: ("Approve", { pendingApproval = notification }),
                              secondary: ("Deny", { pendingDenial = notification }))
            }
            if isEndorserRequest(notification) {
                actionButtons(primary: ("Sign", { pendingAcfSign = notification }),
                              secondary: ("Deny", { pendingAcfDeny = notification }))
            }
            if notification.type == "acf_submitted" && notification.status == "unread" && amRecipient(notification) && withinWithdrawWindow(notification) {
                Button("Withdraw") { withdrawACF(notification) }
                    .buttonStyle(.bordered).tint(.red).controlSize(.small)
                    .padding(.top, 4)
            }
            if ["acf_denied", "acf_withdrawn"].contains(notification.type) && amRecipient(notification) {
                HStack(spacing: 6) {
                    Image(systemName: "square.and.pencil")
                    Text("Tap to review and resubmit").font(.caption)
                }
                .foregroundStyle(.blue)
                .padding(.top, 4)
            }
            if notification.type == "acf_completed" {
                HStack(spacing: 6) {
                    if downloadingId == notification.id { ProgressView() }
                    else { Image(systemName: "arrow.down.circle") }
                    Text("Click this notification to download").font(.caption)
                }
                .foregroundStyle(.blue)
                .padding(.top, 4)
            }
            if let reviewNote = notification.reviewNote, !reviewNote.isEmpty {
                Text("Note: \(reviewNote)")
                    .font(.caption).foregroundStyle(.secondary).padding(.top, 2)
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .onTapGesture {
            if notification.type == "acf_completed" {
                downloadACF(notification)
                return
            }
            if ["acf_denied", "acf_withdrawn"].contains(notification.type), amRecipient(notification) {
                resubmitTarget = notification   // open the full detail/edit page
                if notification.status == "unread" {
                    Task { await appState.markNotificationRead(notification) }
                }
                return
            }
            // Keep sign requests actionable — don't auto-resolve on tap.
            guard notification.type != "unscanned_check",
                  notification.type != "acf_sign_request" else { return }
            if notification.status == "unread" {
                Task { await appState.markNotificationRead(notification) }
            }
        }
    }

    @ViewBuilder
    private func actionButtons(primary: (String, () -> Void), secondary: (String, () -> Void)) -> some View {
        HStack(spacing: 10) {
            Button(primary.0, action: primary.1)
                .buttonStyle(.borderedProminent).controlSize(.small)
            Button(secondary.0, action: secondary.1)
                .buttonStyle(.bordered).tint(.red).controlSize(.small)
        }
        .padding(.top, 4)
    }

    // Completed-form body: "Submitted by NAME, approved by NAME" with blue,
    // tappable names (call), plus the tappable PDF password (copy) for superadmins.
    @ViewBuilder
    private func acfCompletedBody(_ meta: ACFNotificationMeta) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text("Submitted by").font(.subheadline).foregroundStyle(.secondary)
                nameButton(meta.requesterName, phone: meta.requesterPhone)
            }
            HStack(spacing: 4) {
                Text("Approved by").font(.subheadline).foregroundStyle(.secondary)
                nameButton(meta.endorserName, phone: meta.endorserPhone)
            }
            if let pw = meta.password, !pw.isEmpty {
                HStack(spacing: 4) {
                    Text("PDF edit password:").font(.subheadline).foregroundStyle(.secondary)
                    Button {
                        UIPasteboard.general.string = pw
                        showToast("Password copied")
                    } label: {
                        Text(pw).font(.subheadline.monospaced().bold()).foregroundStyle(.blue)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private func nameButton(_ name: String?, phone: String?) -> some View {
        let display = name ?? "—"
        if let phone, !phone.isEmpty {
            Button {
                let digits = phone.filter { $0.isNumber || $0 == "+" }
                if let url = URL(string: "tel:\(digits)") { UIApplication.shared.open(url) }
            } label: {
                Text(display).font(.subheadline.weight(.semibold)).foregroundStyle(.blue)
            }
            .buttonStyle(.plain)
        } else {
            Text(display).font(.subheadline).foregroundStyle(.primary)
        }
    }

    private func showToast(_ text: String) {
        toast = text
        Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            if toast == text { toast = nil }
        }
    }

    private func withdrawACF(_ notification: NotificationItem) {
        guard let formId = notification.relatedEntityId else { return }
        Task {
            do { try await appState.withdrawAssetCheckForm(id: formId) }
            catch { errorMessage = error.localizedDescription }
        }
    }

    private func downloadACF(_ notification: NotificationItem) {
        guard let formId = notification.relatedEntityId, downloadingId == nil else { return }
        downloadingId = notification.id
        Task {
            defer { downloadingId = nil }
            do {
                let (data, filename) = try await appState.downloadAssetCheckForm(id: formId)
                let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
                try data.write(to: url, options: .atomic)
                sharePayload = SharePayload(url: url)
                if notification.status == "unread" {
                    await appState.markNotificationRead(notification)
                }
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    @ViewBuilder
    private func statusIndicator(_ notification: NotificationItem) -> some View {
        switch notification.status {
        case "pending":
            Text("Pending")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.orange)
        case "unread":
            Circle()
                .fill(Color.blue)
                .frame(width: 8, height: 8)
        case "approved":
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.caption)
        case "denied":
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(.red)
                .font(.caption)
        default:
            EmptyView()
        }
    }

    private var sortedNotifications: [NotificationItem] {
        appState.notifications.sorted { l, r in
            if l.status == "pending" && r.status != "pending" { return true }
            if r.status == "pending" && l.status != "pending" { return false }
            return (l.createdAt ?? "") > (r.createdAt ?? "")
        }
    }

    /// Withdraw is allowed for 30 minutes after the form was sent.
    private func withinWithdrawWindow(_ n: NotificationItem) -> Bool {
        guard let iso = n.createdAt else { return false }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = parser.date(from: iso)
        if date == nil {
            parser.formatOptions = [.withInternetDateTime]
            date = parser.date(from: iso)
        }
        guard let date else { return false }
        return Date().timeIntervalSince(date) < 30 * 60
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

    private func approve(_ notification: NotificationItem) {
        Task {
            do {
                try await appState.reviewNotification(notification.id, approved: true, reviewNote: nil)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - Deny Sheet

private struct DenySheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let notification: NotificationItem

    @State private var reason = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Deny Reason") {
                    TextField("Reason for denial", text: $reason, axis: .vertical)
                        .lineLimit(3...)
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red).font(.footnote)
                    }
                }
            }
            .navigationTitle("Deny Request")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Deny") { submit() }
                            .tint(.red)
                            .disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
        .interactiveDismissDisabled(isSubmitting)
    }

    private func submit() {
        let r = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !r.isEmpty else { return }
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                try await appState.reviewNotification(notification.id, approved: false, reviewNote: r)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - ACF Sign Sheet (endorser signature)

private struct ACFSignSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let notification: NotificationItem

    @State private var canvas = PKCanvasView()
    @State private var signatureVersion = 0
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var hasSignature: Bool {
        _ = signatureVersion
        return !canvas.isEmptyDrawing
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(notification.body).font(.subheadline).foregroundStyle(.secondary)
                }
                Section {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .strokeBorder(Color.secondary.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [4]))
                        if !hasSignature {
                            Text("Sign here").foregroundStyle(.tertiary).allowsHitTesting(false)
                        }
                        SignaturePadView(canvas: $canvas) { signatureVersion += 1 }
                    }
                    .frame(height: 160)
                    .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                } header: {
                    HStack {
                        Text("Your signature")
                        Spacer()
                        Button("Clear") { canvas.drawing = PKDrawing(); signatureVersion += 1 }
                            .font(.caption).disabled(!hasSignature)
                    }
                }
                if let errorMessage {
                    Section { Text(errorMessage).font(.footnote).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Sign Asset Form")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting { ProgressView() }
                    else { Button("Sign") { submit() }.disabled(!hasSignature) }
                }
            }
        }
        .interactiveDismissDisabled(isSubmitting)
    }

    private func submit() {
        guard let formId = notification.relatedEntityId, let png = canvas.signaturePNG() else { return }
        isSubmitting = true
        errorMessage = nil
        Task {
            defer { isSubmitting = false }
            do {
                try await appState.signAssetCheckForm(id: formId, signaturePng: png.base64EncodedString())
                await appState.markNotificationRead(notification)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - ACF Deny Sheet

private struct ACFDenySheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let notification: NotificationItem

    @State private var reason = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Deny Reason") {
                    TextField("Reason for denial", text: $reason, axis: .vertical)
                        .lineLimit(3...)
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red).font(.footnote) }
                }
            }
            .navigationTitle("Deny Asset Form")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting { ProgressView() }
                    else {
                        Button("Deny") { submit() }.tint(.red)
                            .disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
        }
        .interactiveDismissDisabled(isSubmitting)
    }

    private func submit() {
        let r = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !r.isEmpty, let formId = notification.relatedEntityId else { return }
        isSubmitting = true
        Task {
            defer { isSubmitting = false }
            do {
                try await appState.denyAssetCheckForm(id: formId, reason: r)
                await appState.markNotificationRead(notification)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - ACF Resubmit Detail (full page: review original info, edit, re-sign)

private struct ACFResubmitDetailView: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss
    let notification: NotificationItem

    @State private var form: AssetCheckForm?
    @State private var isLoading = true
    @State private var loadError: String?

    // Editable fields
    @State private var selectedCompanyId = ""
    @State private var selectedBranchId = ""
    @State private var fileName = ""
    @State private var canvas = PKCanvasView()
    @State private var signatureVersion = 0
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private var selectedCompany: Company? { appState.companies.first { $0.id == selectedCompanyId } }
    private var availableBranches: [Park] { selectedCompany?.branches.sorted { $0.name < $1.name } ?? [] }
    private var selectedBranch: Park? { availableBranches.first { $0.id == selectedBranchId } }

    private var includedAssets: [SKUItem] {
        guard !selectedCompanyId.isEmpty, !selectedBranchId.isEmpty else { return [] }
        return appState.skus.filter {
            $0.warehouseId == selectedCompanyId && $0.branchId == selectedBranchId &&
            ($0.status == .available || $0.status == .borrowed || $0.status == .repairing)
        }
    }
    private var hasEndorser: Bool { !(selectedBranch?.endorserUserId ?? "").isEmpty }
    private var trimmedFileName: String { fileName.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var hasSignature: Bool { _ = signatureVersion; return !canvas.isEmptyDrawing }
    private var canSubmit: Bool {
        !selectedCompanyId.isEmpty && !selectedBranchId.isEmpty && !trimmedFileName.isEmpty &&
        !includedAssets.isEmpty && hasEndorser && hasSignature
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading…")
            } else if let loadError {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle").font(.largeTitle).foregroundStyle(.secondary)
                    Text("Couldn't load").font(.headline)
                    Text(loadError).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .padding()
            } else {
                editor
            }
        }
        .navigationTitle("Review & Resubmit")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var editor: some View {
        Form {
            if let reason = form?.denyReason, !reason.isEmpty {
                Section { Text(reason).font(.footnote).foregroundStyle(.red) } header: { Text("Denied reason") }
            }
            Section("Scope") {
                Picker("Company", selection: $selectedCompanyId) {
                    Text("Select a company").tag("")
                    ForEach(appState.companies) { Text($0.name).tag($0.id) }
                }
                Picker("Branch", selection: $selectedBranchId) {
                    Text("Select a branch").tag("")
                    ForEach(availableBranches) { Text($0.name).tag($0.id) }
                }
                .disabled(availableBranches.isEmpty)
                if !selectedBranchId.isEmpty {
                    HStack {
                        Text("Assets to include"); Spacer()
                        Text("\(includedAssets.count)").foregroundStyle(includedAssets.isEmpty ? .red : .secondary)
                    }
                    HStack {
                        Text("Endorser"); Spacer()
                        Text(selectedBranch?.endorserName ?? "Not set")
                            .foregroundStyle((selectedBranch?.endorserName) == nil ? .orange : .secondary)
                    }
                }
            }

            Section {
                HStack(spacing: 4) {
                    TextField("File name", text: $fileName).autocorrectionDisabled()
                    Text(".pdf").foregroundStyle(.secondary)
                }
            } header: { Text("File name") }

            if let rows = form?.rows, !rows.isEmpty {
                Section("Assets in this form (\(rows.count))") {
                    ForEach(rows.prefix(3)) { r in
                        ACFAssetRow(row: r, liveSKU: appState.skus.first { ($0.skuCode ?? $0.skuNumber) == r.assetId })
                    }
                    if rows.count > 3 {
                        NavigationLink {
                            ACFAssetListView(rows: rows)
                        } label: {
                            Text("View all \(rows.count) assets")
                                .font(.subheadline).foregroundStyle(.blue)
                        }
                    }
                }
            }

            Section {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Color.secondary.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [4]))
                    if !hasSignature { Text("Sign here").foregroundStyle(.tertiary).allowsHitTesting(false) }
                    SignaturePadView(canvas: $canvas) { signatureVersion += 1 }
                }
                .frame(height: 160)
                .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
            } header: {
                HStack {
                    Text("Your signature")
                    Spacer()
                    Button("Clear") { canvas.drawing = PKDrawing(); signatureVersion += 1 }
                        .font(.caption).disabled(!hasSignature)
                }
            }

            if !selectedBranchId.isEmpty && !hasEndorser {
                Section { Text("This branch has no endorser. Set one before resubmitting.").font(.footnote).foregroundStyle(.orange) }
            }
            if let errorMessage {
                Section { Text(errorMessage).font(.footnote).foregroundStyle(.red) }
            }
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if isSubmitting { ProgressView() }
                else { Button("Resubmit") { submit() }.disabled(!canSubmit) }
            }
        }
        .onChange(of: selectedCompanyId) { _ in
            if !availableBranches.contains(where: { $0.id == selectedBranchId }) { selectedBranchId = "" }
        }
    }

    private func load() async {
        guard isLoading, let formId = notification.relatedEntityId else { return }
        do {
            let f = try await appState.getAssetCheckForm(id: formId)
            form = f
            selectedCompanyId = f.companyId ?? ""
            selectedBranchId = f.branchId ?? ""
            fileName = f.acfNo
        } catch {
            loadError = error.localizedDescription
        }
        isLoading = false
    }

    private func submit() {
        guard canSubmit, let formId = notification.relatedEntityId, let png = canvas.signaturePNG() else { return }
        isSubmitting = true
        errorMessage = nil
        Task {
            defer { isSubmitting = false }
            do {
                try await appState.resubmitAssetCheckForm(
                    id: formId,
                    companyId: selectedCompanyId,
                    branchId: selectedBranchId,
                    acfNo: trimmedFileName,
                    signaturePng: png.base64EncodedString()
                )
                await appState.markNotificationRead(notification)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

// MARK: - ACF Asset Row + Full List

/// Category code from an asset id like "PWBJ-CAM-0001" → "CAM" (middle segment).
private func acfCategory(_ assetId: String) -> String {
    let parts = assetId.split(separator: "-")
    return parts.count >= 3 ? String(parts[parts.count - 2]) : "—"
}

/// Numeric suffix from an asset id like "PWBJ-CAM-0012" → 12 (for ascending sort).
private func acfNumber(_ assetId: String) -> Int {
    guard let last = assetId.split(separator: "-").last else { return 0 }
    return Int(last.filter(\.isNumber)) ?? 0
}

/// Inventory-style row for an Asset Check Form asset; uses the live SKU's
/// status pill / park when the item still exists.
private struct ACFAssetRow: View {
    let row: AssetCheckFormRow
    let liveSKU: SKUItem?
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(row.assetId).font(.headline)
                HStack(spacing: 8) {
                    Text(acfCategory(row.assetId)).font(.caption).foregroundStyle(.secondary)
                    if !row.found.isEmpty {
                        Text(row.found).font(.caption).foregroundStyle(.secondary)
                    }
                }
                if !row.description.isEmpty {
                    Text(row.description).font(.caption).foregroundStyle(.tertiary).lineLimit(1)
                }
            }
            Spacer()
            if let sku = liveSKU {
                StatusPill(status: sku.status)
            }
        }
        .padding(.vertical, 4)
    }
}

/// Full asset list with category filter, mirroring the Inventory page.
/// "All" → alphabetical by asset id; a specific category → ascending by number.
/// Tapping an asset opens the SKU detail read-only (no actions).
private struct ACFAssetListView: View {
    @EnvironmentObject private var appState: AppState
    let rows: [AssetCheckFormRow]
    @State private var selectedCategory = "All"

    private var categories: [String] {
        let set = Set(rows.map { acfCategory($0.assetId) })
        return ["All"] + set.sorted()
    }

    private var displayedRows: [AssetCheckFormRow] {
        if selectedCategory == "All" {
            return rows.sorted { $0.assetId.localizedStandardCompare($1.assetId) == .orderedAscending }
        }
        return rows
            .filter { acfCategory($0.assetId) == selectedCategory }
            .sorted { acfNumber($0.assetId) < acfNumber($1.assetId) }
    }

    private func liveSKU(_ assetId: String) -> SKUItem? {
        appState.skus.first { ($0.skuCode ?? $0.skuNumber) == assetId }
    }

    var body: some View {
        List {
            // Liquid Glass category chips, kept tight against the list below —
            // mirrors the Inventory screen layout. (The count is the large title.)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(categories, id: \.self) { cat in
                        ACFGlassChip(label: cat, active: selectedCategory == cat) {
                            selectedCategory = cat
                        }
                    }
                }
                .padding(.vertical, 2)
            }
            .listRowInsets(EdgeInsets(top: 2, leading: 16, bottom: 4, trailing: 8))
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)

            ForEach(displayedRows) { row in
                Section {
                    let live = liveSKU(row.assetId)
                    if let live {
                        NavigationLink {
                            SKUDetailView(initialSKU: live, showsActions: false)
                        } label: {
                            ACFAssetRow(row: row, liveSKU: live)
                        }
                    } else {
                        NavigationLink {
                            ACFRowDetailView(row: row)
                        } label: {
                            ACFAssetRow(row: row, liveSKU: nil)
                        }
                    }
                }
            }
        }
        .compactListSections()
        .navigationTitle(Text("\(displayedRows.count) Assets"))
        .navigationBarTitleDisplayMode(.large)
    }
}

/// Read-only detail for an asset whose live SKU no longer exists — shows the
/// frozen snapshot captured in the Asset Check Form.
private struct ACFRowDetailView: View {
    let row: AssetCheckFormRow
    var body: some View {
        List {
            Section { Text(row.assetId).font(.title3.bold()) }
            Section("Details") {
                LabeledContent("Category", value: acfCategory(row.assetId))
                if !row.location.isEmpty { LabeledContent("Branch", value: row.location) }
                if !row.found.isEmpty { LabeledContent("Found", value: row.found) }
                if !row.serial.isEmpty { LabeledContent("Serial", value: row.serial) }
                if !row.description.isEmpty { LabeledContent("Description", value: row.description) }
            }
            Section("Last scan") {
                if !row.checkedBy.isEmpty { LabeledContent("Checked by", value: row.checkedBy) }
                if !row.date.isEmpty { LabeledContent("Date", value: row.date) }
            }
        }
        .navigationTitle(row.assetId)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Liquid Glass filter chip (iOS 26 `glassEffect`), with a material fallback.
private struct ACFGlassChip: View {
    let label: String
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.subheadline.weight(active ? .semibold : .regular))
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .foregroundStyle(active ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
        .modifier(GlassChipShape(active: active))
    }
}

private struct GlassChipShape: ViewModifier {
    let active: Bool
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(
                active ? .regular.tint(.blue).interactive() : .regular.interactive(),
                in: Capsule()
            )
        } else {
            content.background(
                active ? AnyShapeStyle(Color.blue) : AnyShapeStyle(.ultraThinMaterial),
                in: Capsule()
            )
        }
    }
}

// MARK: - Share Sheet

struct SharePayload: Identifiable {
    let id = UUID()
    let url: URL
}

struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

// MARK: - Unscanned Items Detail

private struct UnscannedItemsDetailView: View {
    @EnvironmentObject private var appState: AppState
    let notification: NotificationItem

    private var items: [SKUItem] {
        let ids = Set(notification.skuIds ?? [])
        return appState.skus.filter { ids.contains($0.id) }
            .sorted { $0.displayCode < $1.displayCode }
    }

    var body: some View {
        List {
            if items.isEmpty {
                EmptyStateView(title: "No items found", systemImage: "shippingbox")
            } else {
                ForEach(items) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.displayCode)
                            .font(.headline)
                        if let sn = item.serialNumber, !sn.isEmpty {
                            Text(sn)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        if let desc = item.descriptionText, !desc.isEmpty {
                            Text(desc)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .navigationTitle(notification.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}
