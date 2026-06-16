import AVFoundation
import SwiftUI
import UIKit

struct CameraScannerView: UIViewRepresentable {
    var isScanning: Bool
    var onCode: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onCode: onCode)
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.isUserInteractionEnabled = false  // let SwiftUI views on top receive touches
        context.coordinator.configure(previewView: view)
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {
        if isScanning {
            context.coordinator.start()
        } else {
            context.coordinator.stop()
        }
    }

    static func dismantleUIView(_ uiView: PreviewView, coordinator: Coordinator) {
        coordinator.stop()
    }

    final class PreviewView: UIView {
        override class var layerClass: AnyClass {
            AVCaptureVideoPreviewLayer.self
        }

        var previewLayer: AVCaptureVideoPreviewLayer {
            layer as! AVCaptureVideoPreviewLayer
        }
    }

    final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate, @unchecked Sendable {
        private let session = AVCaptureSession()
        private let sessionQueue = DispatchQueue(label: "inventory.camera.session")
        private let onCode: (String) -> Void
        private var isConfigured = false
        private var lastCode = ""
        private weak var previewView: PreviewView?

        init(onCode: @escaping (String) -> Void) {
            self.onCode = onCode
        }

        @MainActor
        func configure(previewView: PreviewView) {
            self.previewView = previewView
            previewView.previewLayer.videoGravity = .resizeAspectFill
            previewView.previewLayer.session = session
            guard !isConfigured else { return }

            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                guard let self, allowed else { return }
                self.sessionQueue.async {
                    self.configureSession()
                    if self.isConfigured && !self.session.isRunning {
                        self.session.startRunning()
                    }
                }
            }
        }

        func start() {
            sessionQueue.async {
                if !self.isConfigured {
                    self.configureSession()
                }
                if self.isConfigured && !self.session.isRunning {
                    self.session.startRunning()
                }
            }
        }

        // Fully releases the camera device so another session can use it.
        func stop() {
            sessionQueue.async {
                if self.session.isRunning {
                    self.session.stopRunning()
                }
                guard self.isConfigured else { return }
                self.session.beginConfiguration()
                for input in self.session.inputs { self.session.removeInput(input) }
                for output in self.session.outputs { self.session.removeOutput(output) }
                self.session.commitConfiguration()
                self.isConfigured = false
                self.lastCode = ""
            }
        }

        private func configureSession() {
            guard !isConfigured else { return }
            session.beginConfiguration()
            session.sessionPreset = .high

            let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
            guard let device,
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else {
                session.commitConfiguration()
                return
            }
            session.addInput(input)

            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else {
                session.commitConfiguration()
                return
            }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
            output.metadataObjectTypes = [.qr]

            session.commitConfiguration()
            isConfigured = true
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard
                let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                let value = object.stringValue,
                value != lastCode
            else { return }
            lastCode = value
            onCode(value)
        }
    }
}
