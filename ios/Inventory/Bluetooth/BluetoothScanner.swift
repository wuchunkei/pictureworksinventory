import CoreBluetooth
import Foundation

struct BluetoothDevice: Identifiable, Equatable {
    let id: UUID
    var name: String
    var rssi: Int
}

final class BluetoothScanner: NSObject, ObservableObject {
    @Published private(set) var stateDescription = "Unavailable"
    @Published private(set) var devices: [BluetoothDevice] = []
    @Published private(set) var isScanning = false

    private var centralManager: CBCentralManager!
    private var peripherals: [UUID: CBPeripheral] = [:]

    override init() {
        super.init()
        centralManager = CBCentralManager(delegate: self, queue: nil)
    }

    func startScan() {
        guard centralManager.state == .poweredOn else { return }
        devices = []
        peripherals = [:]
        isScanning = true
        centralManager.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    func stopScan() {
        centralManager.stopScan()
        isScanning = false
    }

    func connect(to device: BluetoothDevice) {
        guard let peripheral = peripherals[device.id] else { return }
        centralManager.connect(peripheral)
    }
}

extension BluetoothScanner: CBCentralManagerDelegate {
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .unknown:
            stateDescription = "Unknown"
        case .resetting:
            stateDescription = "Resetting"
        case .unsupported:
            stateDescription = "Unsupported"
        case .unauthorized:
            stateDescription = "Unauthorized"
        case .poweredOff:
            stateDescription = "Powered off"
        case .poweredOn:
            stateDescription = "Ready"
        @unknown default:
            stateDescription = "Unavailable"
        }
    }

    func centralManager(
        _ central: CBCentralManager,
        didDiscover peripheral: CBPeripheral,
        advertisementData: [String: Any],
        rssi RSSI: NSNumber
    ) {
        peripherals[peripheral.identifier] = peripheral
        let name = peripheral.name
            ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String
            ?? "Unnamed device"
        let device = BluetoothDevice(id: peripheral.identifier, name: name, rssi: RSSI.intValue)
        if let index = devices.firstIndex(where: { $0.id == device.id }) {
            devices[index] = device
        } else {
            devices.append(device)
        }
        devices.sort { $0.rssi > $1.rssi }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        stateDescription = "Connected to \(peripheral.name ?? "device")"
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        stateDescription = error?.localizedDescription ?? "Connection failed"
    }
}
