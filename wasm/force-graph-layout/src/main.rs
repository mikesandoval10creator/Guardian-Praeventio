use serde::Deserialize;
use std::{env, fs, path::PathBuf};

#[derive(Deserialize)]
struct Node { id: String, x: Option<f64>, y: Option<f64> }
#[derive(Deserialize)]
struct Link { source: String, target: String }
#[derive(Deserialize)]
struct Payload { nodes: Vec<Node>, links: Vec<Link>, iterations: u32, dim: u8 }

fn main() {
    let root = PathBuf::from(env::args().nth(1).expect("fixture directory"));
    for size in [100, 1000, 10000] {
        let path = root.join(format!("fixtures-{size}.json"));
        let payload: Payload = serde_json::from_slice(&fs::read(&path).expect("fixture"))
            .expect("valid fixture JSON");
        let ids: std::collections::HashSet<&str> = payload.nodes.iter().map(|n| n.id.as_str()).collect();
        let valid_links = payload.links.iter().filter(|l| ids.contains(l.source.as_str()) && ids.contains(l.target.as_str())).count();
        let seeded = payload.nodes.iter().filter(|n| n.x.is_some() && n.y.is_some()).count();
        assert_eq!(payload.nodes.len(), size);
        assert_eq!(payload.links.len(), size - 1);
        assert_eq!(valid_links, payload.links.len());
        assert_eq!(seeded, size);
        assert_eq!(payload.iterations, 60);
        assert_eq!(payload.dim, 2);
        println!("fixture={size} nodes={} links={} valid_links={} seeded={}", payload.nodes.len(), payload.links.len(), valid_links, seeded);
    }
}
