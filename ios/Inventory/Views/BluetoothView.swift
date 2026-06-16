import SwiftUI

struct BluetoothView: View {
    @StateObject private var scanner = BluetoothScanner()

    var body: some View {
        List {
            Section {
                HStack {
                    Label(scanner.stateDescription, systemImage: "dot.radiowaves.left.and.right")
                    Spacer()
                    Button(scanner.isScanning ? "Stop" : "Scan") {
                        scanner.isScanning ? scanner.stopScan() : scanner.startScan()
                    }
                    .buttonStyle(.bordered)
                }
            }

            Section("Devices") {
                if scanner.devices.isEmpty {
                    EmptyStateView(title: "No Bluetooth devices", systemImage: "wave.3.right")
                } else {
                    ForEach(scanner.devices) { device in
                        Button {
                            scanner.connect(to: device)
                        } label: {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(device.name)
                                    Text(device.id.uuidString)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text("\(device.rssi)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Bluetooth")
    }
}
