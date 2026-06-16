import SwiftUI

struct CountryCode: Equatable {
    let code: String    // e.g. "+86" — sent to backend
    let flag: String
    let label: String   // English name, unique, used as ForEach id

    static let recommended: [CountryCode] = [
        CountryCode(code: "+86",  flag: "🇨🇳", label: "China"),
        CountryCode(code: "+852", flag: "🇭🇰", label: "Hong Kong"),
        CountryCode(code: "+853", flag: "🇲🇴", label: "Macao"),
        CountryCode(code: "+886", flag: "🇹🇼", label: "Taiwan"),
    ]

    // Full list — sorted A-Z by English label.
    // Recommended 4 appear in the "Recommended" section; this list is used for "All".
    static let all: [CountryCode] = [
        CountryCode(code: "+93",  flag: "🇦🇫", label: "Afghanistan"),
        CountryCode(code: "+355", flag: "🇦🇱", label: "Albania"),
        CountryCode(code: "+213", flag: "🇩🇿", label: "Algeria"),
        CountryCode(code: "+54",  flag: "🇦🇷", label: "Argentina"),
        CountryCode(code: "+61",  flag: "🇦🇺", label: "Australia"),
        CountryCode(code: "+43",  flag: "🇦🇹", label: "Austria"),
        CountryCode(code: "+973", flag: "🇧🇭", label: "Bahrain"),
        CountryCode(code: "+880", flag: "🇧🇩", label: "Bangladesh"),
        CountryCode(code: "+32",  flag: "🇧🇪", label: "Belgium"),
        CountryCode(code: "+591", flag: "🇧🇴", label: "Bolivia"),
        CountryCode(code: "+55",  flag: "🇧🇷", label: "Brazil"),
        CountryCode(code: "+855", flag: "🇰🇭", label: "Cambodia"),
        CountryCode(code: "+1",   flag: "🇨🇦", label: "Canada"),
        CountryCode(code: "+56",  flag: "🇨🇱", label: "Chile"),
        CountryCode(code: "+86",  flag: "🇨🇳", label: "China"),
        CountryCode(code: "+57",  flag: "🇨🇴", label: "Colombia"),
        CountryCode(code: "+385", flag: "🇭🇷", label: "Croatia"),
        CountryCode(code: "+420", flag: "🇨🇿", label: "Czech Republic"),
        CountryCode(code: "+45",  flag: "🇩🇰", label: "Denmark"),
        CountryCode(code: "+593", flag: "🇪🇨", label: "Ecuador"),
        CountryCode(code: "+20",  flag: "🇪🇬", label: "Egypt"),
        CountryCode(code: "+358", flag: "🇫🇮", label: "Finland"),
        CountryCode(code: "+33",  flag: "🇫🇷", label: "France"),
        CountryCode(code: "+49",  flag: "🇩🇪", label: "Germany"),
        CountryCode(code: "+233", flag: "🇬🇭", label: "Ghana"),
        CountryCode(code: "+30",  flag: "🇬🇷", label: "Greece"),
        CountryCode(code: "+852", flag: "🇭🇰", label: "Hong Kong"),
        CountryCode(code: "+36",  flag: "🇭🇺", label: "Hungary"),
        CountryCode(code: "+91",  flag: "🇮🇳", label: "India"),
        CountryCode(code: "+62",  flag: "🇮🇩", label: "Indonesia"),
        CountryCode(code: "+98",  flag: "🇮🇷", label: "Iran"),
        CountryCode(code: "+964", flag: "🇮🇶", label: "Iraq"),
        CountryCode(code: "+353", flag: "🇮🇪", label: "Ireland"),
        CountryCode(code: "+972", flag: "🇮🇱", label: "Israel"),
        CountryCode(code: "+39",  flag: "🇮🇹", label: "Italy"),
        CountryCode(code: "+81",  flag: "🇯🇵", label: "Japan"),
        CountryCode(code: "+962", flag: "🇯🇴", label: "Jordan"),
        CountryCode(code: "+7",   flag: "🇰🇿", label: "Kazakhstan"),
        CountryCode(code: "+254", flag: "🇰🇪", label: "Kenya"),
        CountryCode(code: "+82",  flag: "🇰🇷", label: "Korea, South"),
        CountryCode(code: "+965", flag: "🇰🇼", label: "Kuwait"),
        CountryCode(code: "+961", flag: "🇱🇧", label: "Lebanon"),
        CountryCode(code: "+218", flag: "🇱🇾", label: "Libya"),
        CountryCode(code: "+853", flag: "🇲🇴", label: "Macao"),
        CountryCode(code: "+60",  flag: "🇲🇾", label: "Malaysia"),
        CountryCode(code: "+52",  flag: "🇲🇽", label: "Mexico"),
        CountryCode(code: "+212", flag: "🇲🇦", label: "Morocco"),
        CountryCode(code: "+95",  flag: "🇲🇲", label: "Myanmar"),
        CountryCode(code: "+977", flag: "🇳🇵", label: "Nepal"),
        CountryCode(code: "+31",  flag: "🇳🇱", label: "Netherlands"),
        CountryCode(code: "+64",  flag: "🇳🇿", label: "New Zealand"),
        CountryCode(code: "+234", flag: "🇳🇬", label: "Nigeria"),
        CountryCode(code: "+47",  flag: "🇳🇴", label: "Norway"),
        CountryCode(code: "+968", flag: "🇴🇲", label: "Oman"),
        CountryCode(code: "+92",  flag: "🇵🇰", label: "Pakistan"),
        CountryCode(code: "+51",  flag: "🇵🇪", label: "Peru"),
        CountryCode(code: "+63",  flag: "🇵🇭", label: "Philippines"),
        CountryCode(code: "+48",  flag: "🇵🇱", label: "Poland"),
        CountryCode(code: "+351", flag: "🇵🇹", label: "Portugal"),
        CountryCode(code: "+974", flag: "🇶🇦", label: "Qatar"),
        CountryCode(code: "+40",  flag: "🇷🇴", label: "Romania"),
        CountryCode(code: "+7",   flag: "🇷🇺", label: "Russia"),
        CountryCode(code: "+966", flag: "🇸🇦", label: "Saudi Arabia"),
        CountryCode(code: "+65",  flag: "🇸🇬", label: "Singapore"),
        CountryCode(code: "+27",  flag: "🇿🇦", label: "South Africa"),
        CountryCode(code: "+34",  flag: "🇪🇸", label: "Spain"),
        CountryCode(code: "+94",  flag: "🇱🇰", label: "Sri Lanka"),
        CountryCode(code: "+46",  flag: "🇸🇪", label: "Sweden"),
        CountryCode(code: "+41",  flag: "🇨🇭", label: "Switzerland"),
        CountryCode(code: "+886", flag: "🇹🇼", label: "Taiwan"),
        CountryCode(code: "+66",  flag: "🇹🇭", label: "Thailand"),
        CountryCode(code: "+90",  flag: "🇹🇷", label: "Turkey"),
        CountryCode(code: "+971", flag: "🇦🇪", label: "United Arab Emirates"),
        CountryCode(code: "+44",  flag: "🇬🇧", label: "United Kingdom"),
        CountryCode(code: "+380", flag: "🇺🇦", label: "Ukraine"),
        CountryCode(code: "+1",   flag: "🇺🇸", label: "United States"),
        CountryCode(code: "+84",  flag: "🇻🇳", label: "Vietnam"),
    ].sorted { $0.label.compare($1.label, locale: Locale(identifier: "en")) == .orderedAscending }
}

// MARK: - Validation helpers

func validatePhone(digits: String, countryCode: String) -> String? {
    let d = digits.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !d.isEmpty else { return nil }
    if countryCode == "+86", d.count != 11 {
        return "China (+86) phone number must be exactly 11 digits."
    }
    return nil
}

func validateEmail(_ email: String) -> String? {
    let e = email.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !e.isEmpty else { return nil }
    guard let atRange = e.range(of: "@"),
          atRange.lowerBound > e.startIndex,
          e[e.index(after: atRange.lowerBound)...].contains(".") else {
        return "Email must include a domain (e.g. user@example.com)."
    }
    return nil
}

// MARK: - PhoneField

struct PhoneField: View {
    @Binding var digits: String
    @Binding var countryCode: String
    @State private var showingPicker = false

    private var current: CountryCode {
        CountryCode.all.first { $0.code == countryCode } ?? CountryCode.recommended[0]
    }

    var body: some View {
        HStack(spacing: 6) {
            Button { showingPicker = true } label: {
                HStack(spacing: 2) {
                    Text("\(current.flag) \(current.code)")
                        .foregroundStyle(.primary)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            .sheet(isPresented: $showingPicker) {
                CountryPickerSheet(selected: $countryCode)
            }

            Divider().frame(height: 20)

            TextField("Phone", text: $digits)
                .onChange(of: digits) { newVal in
                    let filtered = newVal.filter { $0.isNumber }
                    if filtered != newVal { digits = filtered }
                }
                .keyboardType(.numberPad)
        }
    }
}

// MARK: - CountryPickerSheet

struct CountryPickerSheet: View {
    @Binding var selected: String
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    private var filtered: [CountryCode] {
        guard !search.isEmpty else { return CountryCode.all }
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return CountryCode.all.filter {
            $0.label.localizedCaseInsensitiveContains(q) || $0.code.contains(q)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if search.isEmpty {
                    Section("Recommended") {
                        ForEach(CountryCode.recommended, id: \.label) { entry in
                            row(entry)
                        }
                    }
                    Section("All Countries") {
                        ForEach(filtered, id: \.label) { entry in
                            row(entry)
                        }
                    }
                } else {
                    ForEach(filtered, id: \.label) { entry in
                        row(entry)
                    }
                }
            }
            .searchable(text: $search, prompt: "Search country or code")
            .navigationTitle("Country Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func row(_ entry: CountryCode) -> some View {
        Button {
            selected = entry.code
            dismiss()
        } label: {
            HStack {
                Text(entry.flag).font(.title3)
                Text(entry.label)
                Spacer()
                Text(entry.code)
                    .foregroundStyle(.secondary)
                    .font(.subheadline)
                if selected == entry.code {
                    Image(systemName: "checkmark")
                        .foregroundStyle(.blue)
                        .font(.subheadline)
                }
            }
            .foregroundStyle(.primary)
        }
    }
}

extension View {
    /// Tightens the top gap between a `.searchable` search bar and the first
    /// List content. Uses a small margin (not 0) so the first card's top corners
    /// still render rounded — a 0 top margin makes insetGrouped clip them square.
    @ViewBuilder
    func tightSearchTopInset() -> some View {
        if #available(iOS 17.0, *) {
            self.contentMargins(.top, 8, for: .scrollContent)
        } else {
            self
        }
    }
}
