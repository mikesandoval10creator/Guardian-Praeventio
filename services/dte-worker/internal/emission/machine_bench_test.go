package emission

import "testing"

// BenchmarkHotPath mirrors the Node reference (bench/node/machine-bench.mjs):
// a mixed workload of enqueue (20% stale-retry duplicates), claim and
// complete over a growing emission set.
func BenchmarkHotPath(b *testing.B) {
	m := newTestMachine()
	key := 0
	for i := 0; i < b.N; i++ {
		switch i % 5 {
		case 0, 1:
			key++
			m.Enqueue(Request{TenantID: "t", IdempotencyKey: "k" + string(rune(key%97)), DocumentType: "33"})
		case 2:
			if c := m.ClaimNext("w"); c != nil {
				_ = m.Complete(c.ID, "ref")
			}
		default:
			m.Enqueue(Request{TenantID: "t", IdempotencyKey: "k" + string(rune(key%97)), DocumentType: "33"})
		}
	}
}
