import SwiftUI
import PencilKit

// MARK: - Signature Pad (PencilKit)

/// A finger/Apple-Pencil signature pad, mirroring the iOS "Markup" signature feel.
/// Produces a transparent PNG the backend composites into the PDF and XLSX.
struct SignaturePadView: UIViewRepresentable {
    @Binding var canvas: PKCanvasView
    var onChange: () -> Void = {}

    func makeUIView(context: Context) -> PKCanvasView {
        canvas.drawingPolicy = .anyInput            // finger works, not just Pencil
        canvas.tool = PKInkingTool(.pen, color: .label, width: 3)
        canvas.backgroundColor = .clear
        canvas.isOpaque = false
        canvas.delegate = context.coordinator
        return canvas
    }

    func updateUIView(_ uiView: PKCanvasView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onChange: onChange) }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        let onChange: () -> Void
        init(onChange: @escaping () -> Void) { self.onChange = onChange }
        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) { onChange() }
    }
}

extension PKCanvasView {
    var isEmptyDrawing: Bool { drawing.bounds.isEmpty }

    /// Transparent PNG of the current ink (nil if nothing drawn).
    func signaturePNG(scale: CGFloat = UIScreen.main.scale) -> Data? {
        guard !isEmptyDrawing else { return nil }
        let image = drawing.image(from: bounds, scale: scale)
        return image.pngData()
    }
}

// MARK: - Export Asset Check Form

struct ExportACFSheet: View {
    @EnvironmentObject private var appState: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var selectedCompanyId = ""
    @State private var selectedBranchId = ""
    @State private var fileName = ""
    @State private var canvas = PKCanvasView()
    @State private var signatureVersion = 0   // bump to force redraw after clear
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var didSubmit = false

    private var selectedCompany: Company? {
        appState.companies.first { $0.id == selectedCompanyId }
    }
    private var availableBranches: [Park] {
        selectedCompany?.branches.sorted { $0.name < $1.name } ?? []
    }
    private var selectedBranch: Park? {
        availableBranches.first { $0.id == selectedBranchId }
    }

    /// Assets that would be included: this branch, excluding disposed/sold.
    private var includedAssets: [SKUItem] {
        guard !selectedCompanyId.isEmpty, !selectedBranchId.isEmpty else { return [] }
        return appState.skus.filter {
            $0.warehouseId == selectedCompanyId &&
            $0.branchId == selectedBranchId &&
            ($0.status == .available || $0.status == .borrowed || $0.status == .repairing)
        }
    }

    private var trimmedFileName: String {
        fileName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var fullFileName: String {
        trimmedFileName.isEmpty ? "" : "\(trimmedFileName).pdf"
    }

    private var hasSignature: Bool {
        // signatureVersion forces re-evaluation; canvas mutation isn't observed.
        _ = signatureVersion
        return !canvas.isEmptyDrawing
    }

    private var hasEndorser: Bool {
        !(selectedBranch?.endorserUserId ?? "").isEmpty
    }

    private var canSubmit: Bool {
        !selectedCompanyId.isEmpty &&
        !selectedBranchId.isEmpty &&
        !trimmedFileName.isEmpty &&
        !includedAssets.isEmpty &&
        hasEndorser &&
        hasSignature
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Scope") {
                    Picker("Company", selection: $selectedCompanyId) {
                        Text("Select a company").tag("")
                        ForEach(appState.companies) { company in
                            Text(company.name).tag(company.id)
                        }
                    }
                    Picker("Branch", selection: $selectedBranchId) {
                        Text("Select a branch").tag("")
                        ForEach(availableBranches) { branch in
                            Text(branch.name).tag(branch.id)
                        }
                    }
                    .disabled(availableBranches.isEmpty)

                    if !selectedBranchId.isEmpty {
                        HStack {
                            Text("Assets to include")
                            Spacer()
                            Text("\(includedAssets.count)")
                                .foregroundStyle(includedAssets.isEmpty ? .red : .secondary)
                        }
                        endorserRow
                    }
                }

                Section {
                    HStack(spacing: 4) {
                        TextField("File name", text: $fileName)
                            .autocorrectionDisabled()
                        Text(".pdf").foregroundStyle(.secondary)
                    }
                } header: {
                    Text("File name")
                } footer: {
                    if !fullFileName.isEmpty {
                        Text("ACF NO: \(trimmedFileName)")
                            .font(.footnote.monospaced())
                    }
                }

                Section {
                    signaturePad
                } header: {
                    HStack {
                        Text("Your signature")
                        Spacer()
                        Button("Clear") {
                            canvas.drawing = PKDrawing()
                            signatureVersion += 1
                        }
                        .font(.caption)
                        .disabled(!hasSignature)
                    }
                } footer: {
                    Text("Sign with your finger or Apple Pencil. After you submit, the branch endorser is notified to sign before the form is finalized.")
                }

                if !selectedBranchId.isEmpty && !hasEndorser {
                    Section {
                        Text("This branch has no endorser. Set one in the branch settings before exporting.")
                            .font(.footnote).foregroundStyle(.orange)
                    }
                }
                if let errorMessage {
                    Section {
                        Text(errorMessage).font(.footnote).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Export Asset Form")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Submit") { submit() }.disabled(!canSubmit)
                    }
                }
            }
            .onChange(of: selectedCompanyId) { _ in selectedBranchId = "" }
        }
    }

    @ViewBuilder
    private var endorserRow: some View {
        HStack {
            Text("Endorser")
            Spacer()
            if let name = selectedBranch?.endorserName, !name.isEmpty {
                Text(name).foregroundStyle(.secondary)
            } else {
                Text("Not set")
                    .foregroundStyle(.orange)
            }
        }
    }

    private var signaturePad: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(Color.secondary.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [4]))
            if !hasSignature {
                Text("Sign here")
                    .foregroundStyle(.tertiary)
                    .allowsHitTesting(false)
            }
            SignaturePadView(canvas: $canvas) { signatureVersion += 1 }
        }
        .frame(height: 160)
        .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
    }

    private func submit() {
        guard canSubmit, let png = canvas.signaturePNG() else { return }
        let signatureBase64 = png.base64EncodedString()
        isSubmitting = true
        errorMessage = nil
        Task {
            defer { isSubmitting = false }
            do {
                _ = try await appState.createAssetCheckForm(
                    companyId: selectedCompanyId,
                    branchId: selectedBranchId,
                    acfNo: trimmedFileName,
                    signaturePng: signatureBase64
                )
                didSubmit = true
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
