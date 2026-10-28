// Isolated research port of d3-force 2D behavior used by Guardian's worker.
// Algorithm attribution: d3-force / d3-quadtree, Copyright Mike Bostock,
// ISC (license texts in LICENSES/; an earlier lab note named the wrong license).
// Preserve upstream license before any product integration.
// No network, persistence, safety decision, or change to the product path.
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, env, fs};
#[derive(Deserialize)]
struct InputNode {
    id: String,
    x: Option<f64>,
    y: Option<f64>,
    z: Option<f64>,
}
#[derive(Deserialize)]
struct Link {
    source: String,
    target: String,
}
#[derive(Deserialize)]
struct Payload {
    nodes: Vec<InputNode>,
    links: Vec<Link>,
    iterations: Option<f64>,
    dim: Option<u8>,
}
#[derive(Clone)]
struct Node {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
}
#[derive(Serialize)]
struct Position {
    id: String,
    x: f64,
    y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    z: Option<f64>,
}
struct Random(u32);
impl Random {
    fn jiggle(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(1664525).wrapping_add(1013904223);
        (self.0 as f64 / 4294967296.0 - 0.5) * 1e-6
    }
}
struct Quad {
    bounds: [f64; 4],
    children: Vec<Option<Box<Quad>>>,
    ids: Vec<usize>,
    x: f64,
    y: f64,
    value: f64,
}
impl Quad {
    fn new(points: &[(f64, f64)], ids: Vec<usize>, bounds: [f64; 4]) -> Self {
        let mut q = Self {
            bounds,
            children: Vec::new(),
            ids: Vec::new(),
            x: 0.0,
            y: 0.0,
            value: 0.0,
        };
        let (x, y) = points[ids[0]];
        if ids.iter().all(|&i| points[i] == (x, y)) {
            q.ids = ids.into_iter().rev().collect();
            q.x = x;
            q.y = y;
            q.value = -30.0 * q.ids.len() as f64;
            return q;
        }
        let [x0, y0, x1, y1] = bounds;
        let xm = (x0 + x1) / 2.0;
        let ym = (y0 + y1) / 2.0;
        let mut groups = [Vec::new(), Vec::new(), Vec::new(), Vec::new()];
        for i in ids {
            let (x, y) = points[i];
            groups[((y >= ym) as usize) * 2 + (x >= xm) as usize].push(i);
        }
        let boxes = [
            [x0, y0, xm, ym],
            [xm, y0, x1, ym],
            [x0, ym, xm, y1],
            [xm, ym, x1, y1],
        ];
        let mut weight = 0.0;
        for (k, g) in groups.into_iter().enumerate() {
            if g.is_empty() {
                q.children.push(None);
            } else {
                let c = Box::new(Self::new(points, g, boxes[k]));
                let w = c.value.abs();
                q.value += c.value;
                weight += w;
                q.x += w * c.x;
                q.y += w * c.y;
                q.children.push(Some(c));
            }
        }
        q.x /= weight;
        q.y /= weight;
        q
    }
    fn build(nodes: &[Node], predicted: bool) -> Option<Self> {
        if nodes.is_empty() {
            return None;
        }
        let points: Vec<_> = nodes
            .iter()
            .map(|n| {
                if predicted {
                    (n.x + n.vx, n.y + n.vy)
                } else {
                    (n.x, n.y)
                }
            })
            .collect();
        let mut minx = f64::INFINITY;
        let mut miny = f64::INFINITY;
        let mut maxx = f64::NEG_INFINITY;
        let mut maxy = f64::NEG_INFINITY;
        for &(x, y) in &points {
            minx = minx.min(x);
            miny = miny.min(y);
            maxx = maxx.max(x);
            maxy = maxy.max(y);
        }
        let x0 = minx.floor();
        let y0 = miny.floor();
        let mut side = 1.0;
        while maxx >= x0 + side || maxy >= y0 + side {
            side *= 2.0;
        }
        Some(Self::new(
            &points,
            (0..nodes.len()).collect(),
            [x0, y0, x0 + side, y0 + side],
        ))
    }
    fn charge(&self, node: &mut Node, index: usize, alpha: f64, random: &mut Random) {
        let mut x = self.x - node.x;
        let mut y = self.y - node.y;
        let w = self.bounds[2] - self.bounds[0];
        let mut l = x * x + y * y;
        if w * w / 0.81 < l {
            if x == 0.0 {
                x = random.jiggle();
                l += x * x;
            }
            if y == 0.0 {
                y = random.jiggle();
                l += y * y;
            }
            if l < 1.0 {
                l = l.sqrt();
            }
            node.vx += x * self.value * alpha / l;
            node.vy += y * self.value * alpha / l;
            return;
        }
        if !self.children.is_empty() {
            for child in self.children.iter().flatten() {
                child.charge(node, index, alpha, random);
            }
            return;
        }
        if self.ids[0] != index || self.ids.len() > 1 {
            if x == 0.0 {
                x = random.jiggle();
                l += x * x;
            }
            if y == 0.0 {
                y = random.jiggle();
                l += y * y;
            }
            if l < 1.0 {
                l = l.sqrt();
            }
        }
        for &j in &self.ids {
            if j != index {
                let w = -30.0 * alpha / l;
                node.vx += x * w;
                node.vy += y * w;
            }
        }
    }
    fn collide(&self, nodes: &mut [Node], index: usize, xi: f64, yi: f64, random: &mut Random) {
        if !self.ids.is_empty() {
            let j = self.ids[0];
            if j > index {
                let mut x = xi - nodes[j].x - nodes[j].vx;
                let mut y = yi - nodes[j].y - nodes[j].vy;
                let mut l = x * x + y * y;
                if l < 144.0 {
                    if x == 0.0 {
                        x = random.jiggle();
                        l += x * x;
                    }
                    if y == 0.0 {
                        y = random.jiggle();
                        l += y * y;
                    }
                    l = l.sqrt();
                    l = (12.0 - l) / l;
                    x *= l;
                    y *= l;
                    nodes[index].vx += x * 0.5;
                    nodes[index].vy += y * 0.5;
                    nodes[j].vx -= x * 0.5;
                    nodes[j].vy -= y * 0.5;
                }
            }
            return;
        }
        let [x0, y0, x1, y1] = self.bounds;
        if x0 > xi + 12.0 || x1 < xi - 12.0 || y0 > yi + 12.0 || y1 < yi - 12.0 {
            return;
        }
        for child in self.children.iter().flatten() {
            child.collide(nodes, index, xi, yi, random);
        }
    }
}
fn simulate(p: Payload) -> Vec<Position> {
    let mut nodes: Vec<_> = p
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let (x, y) = match (n.x, n.y) {
                (Some(x), Some(y)) if !x.is_nan() && !y.is_nan() => (x, y),
                _ => {
                    let r = 10.0 * (0.5 + i as f64).sqrt();
                    let a = i as f64 * std::f64::consts::PI * (3.0 - 5.0_f64.sqrt());
                    (r * a.cos(), r * a.sin())
                }
            };
            Node {
                x,
                y,
                vx: 0.0,
                vy: 0.0,
            }
        })
        .collect();
    let index: HashMap<_, _> = p
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();
    let links: Vec<_> = p
        .links
        .iter()
        .filter_map(|l| {
            Some((
                *index.get(l.source.as_str())?,
                *index.get(l.target.as_str())?,
            ))
        })
        .collect();
    let mut degree = vec![0usize; nodes.len()];
    for &(s, t) in &links {
        degree[s] += 1;
        degree[t] += 1;
    }
    let biases: Vec<_> = links
        .iter()
        .map(|&(s, t)| degree[s] as f64 / (degree[s] + degree[t]) as f64)
        .collect();
    let strengths: Vec<_> = links
        .iter()
        .map(|&(s, t)| 1.0 / degree[s].min(degree[t]) as f64)
        .collect();
    let mut alpha = 1.0;
    let decay = 1.0 - 0.001_f64.powf(1.0 / 300.0);
    let mut random = Random(1);
    let ticks = p.iterations.unwrap_or(60.0).clamp(1.0, 600.0).ceil() as usize;
    for _ in 0..ticks {
        alpha += (0.0 - alpha) * decay;
        if let Some(tree) = Quad::build(&nodes, false) {
            for (i, n) in nodes.iter_mut().enumerate() {
                tree.charge(n, i, alpha, &mut random);
            }
        }
        for (k, &(s, t)) in links.iter().enumerate() {
            let mut x = nodes[t].x + nodes[t].vx - nodes[s].x - nodes[s].vx;
            let mut y = nodes[t].y + nodes[t].vy - nodes[s].y - nodes[s].vy;
            if x == 0.0 {
                x = random.jiggle();
            }
            if y == 0.0 {
                y = random.jiggle();
            }
            let length = (x * x + y * y).sqrt();
            let scale = (length - 30.0) / length * alpha * strengths[k];
            x *= scale;
            y *= scale;
            nodes[t].vx -= x * biases[k];
            nodes[t].vy -= y * biases[k];
            nodes[s].vx += x * (1.0 - biases[k]);
            nodes[s].vy += y * (1.0 - biases[k]);
        }
        let mut sx = 0.0;
        let mut sy = 0.0;
        for n in &nodes {
            sx += n.x;
            sy += n.y;
        }
        sx /= nodes.len() as f64;
        sy /= nodes.len() as f64;
        for n in &mut nodes {
            n.x -= sx;
            n.y -= sy;
        }
        if let Some(tree) = Quad::build(&nodes, true) {
            for i in 0..nodes.len() {
                let xi = nodes[i].x + nodes[i].vx;
                let yi = nodes[i].y + nodes[i].vy;
                tree.collide(&mut nodes, i, xi, yi, &mut random);
            }
        }
        for n in &mut nodes {
            n.vx *= 0.6;
            n.x += n.vx;
            n.vy *= 0.6;
            n.y += n.vy;
        }
    }
    nodes
        .iter()
        .zip(p.nodes)
        .map(|(n, input)| Position {
            id: input.id,
            x: n.x,
            y: n.y,
            z: if p.dim == Some(3) {
                Some(input.z.unwrap_or(0.0))
            } else {
                None
            },
        })
        .collect()
}
// Trusted research ABI only; callers own each allocation and must free it once.
// Production integration still needs bounded input, typed errors and Worker isolation.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn graph_alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn graph_free(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn graph_layout(ptr: *const u8, len: usize) -> u64 {
    let p: Payload =
        serde_json::from_slice(std::slice::from_raw_parts(ptr, len)).expect("typed input");
    let bytes = serde_json::to_vec(&simulate(p))
        .expect("positions")
        .into_boxed_slice();
    let size = bytes.len();
    let address = Box::into_raw(bytes) as *mut u8 as u32;
    ((size as u64) << 32) | address as u64
}
fn main() {
    let file = env::args().nth(1).expect("payload JSON file");
    let p: Payload =
        serde_json::from_slice(&fs::read(file).expect("input file")).expect("valid typed payload");
    println!(
        "{}",
        serde_json::to_string(&simulate(p)).expect("serializable positions")
    );
}
