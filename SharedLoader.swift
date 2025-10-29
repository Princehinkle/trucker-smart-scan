import Foundation

struct Rule: Decodable {
    let pattern: String
    let category: String
    let type: String
    let notes: String?
}

class SharedLoader {
    static func loadRules() -> [Rule] {
        guard let url = Bundle.main.url(forResource: "rules", withExtension: "json") else { return [] }
        let data = try! Data(contentsOf: url)
        return try! JSONDecoder().decode([Rule].self, from: data)
    }

    static func loadSchema() -> [String] {
        guard let url = Bundle.main.url(forResource: "schema", withExtension: "json") else { return [] }
        let data = try! Data(contentsOf: url)
        let json = try! JSONSerialization.jsonObject(with: data) as! [String:Any]
        return json["columns"] as? [String] ?? []
    }
}
