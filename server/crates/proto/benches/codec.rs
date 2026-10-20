use criterion::{black_box, criterion_group, criterion_main, Criterion, Throughput};
use gunbrawl_proto::{decode, encode, encode_into, ActorSnap, EventSnap, ProjSnap, Snapshot};

fn sample_snapshot() -> Snapshot {
    let actor = ActorSnap {
        id: 0,
        x: 1600,
        y: -320,
        vx: 240,
        vy: -160,
        facing: 1,
        flags: 0b1011,
        status: 0,
        stocks: 3,
        weapon: 2,
        ammo: 12,
        reserve: 48,
        fire_cd: 0,
        reload: 0,
        respawn: 0,
    };
    Snapshot {
        tick: 12_345,
        server_ms: 205_750,
        acks: [42, 41, 40, 0],
        actors: vec![
            ActorSnap { id: 1, ..actor },
            ActorSnap { id: 2, ..actor },
            ActorSnap { id: 3, ..actor },
            actor,
        ],
        projectiles: (0..20)
            .map(|index| ProjSnap {
                id: index as u8,
                owner: (index % 4) as u8,
                x: 900 + index * 40,
                y: 300,
                vx: 960,
                vy: -480,
            })
            .collect(),
        events: vec![EventSnap {
            tick: 12_345,
            kind: 1,
            a: 0,
            b: 2,
        }],
    }
}

fn codec(c: &mut Criterion) {
    let snapshot = sample_snapshot();
    let bytes = encode(&snapshot).expect("encode");
    println!("snapshot wire size: {} bytes", bytes.len());

    let mut group = c.benchmark_group("snapshot");
    group.throughput(Throughput::Bytes(bytes.len() as u64));
    group.bench_function("encode_into (reused buffer)", |b| {
        let mut buffer = Vec::with_capacity(1024);
        b.iter(|| {
            encode_into(black_box(&snapshot), &mut buffer).expect("encode");
            black_box(buffer.len());
        });
    });
    group.bench_function("decode", |b| {
        b.iter(|| black_box(decode::<Snapshot>(black_box(&bytes)).expect("decode")));
    });
    group.finish();
}

criterion_group!(benches, codec);
criterion_main!(benches);
