use super::*;

/// Published BIP-340 / Prime fixture x-only keys (secrets 1, 2 and 3): test keys only.
const K1: &str = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const K2: &str = "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
const K3: &str = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
const SIG: &str = "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
const NOW: i64 = 1_790_000_000;

fn call(op: &str, input: Value) -> Result<Value, String> {
    let request = encode(&Value::obj(vec![("abi", Value::Int(1)), ("input", input), ("op", Value::str(op)), ("seq", Value::Int(7))]));
    let response = parse(&dispatch(&request)).expect("canonical response");
    match response.get("status").and_then(Value::as_str) {
        Some("ok") => Ok(response.get("result").cloned().expect("result")),
        _ => Err(response.get("code").and_then(Value::as_str).unwrap_or("?").to_string()),
    }
}

fn keys() -> Value {
    Value::obj(vec![
        ("principals", Value::Array(vec![
            Value::obj(vec![("name", Value::str("x1")), ("pubkey", Value::str(K2))]),
            Value::obj(vec![("name", Value::str("lane/claude")), ("pubkey", Value::str(K3))]),
        ])),
        ("witness", Value::str(K1)),
    ])
}

fn rows(tags: &[(&str, &str)]) -> Vec<Vec<String>> {
    tags.iter().map(|(name, value)| vec![name.to_string(), value.to_string()]).collect()
}

/// An event whose id this cell computes; the signature is a Host fact here.
fn event(pubkey: &str, created_at: i64, kind: i64, tags: Vec<Vec<String>>, content: &str) -> Value {
    let id = event_id(pubkey, created_at, kind, &tags, content).expect("event bounds");
    event_value(&Event { id, pubkey: pubkey.to_string(), created_at, kind, tags, content: content.to_string(), sig: SIG.to_string() })
}

fn facts(sig_valid: bool, seen_id: bool, seen_key: bool) -> Value {
    Value::obj(vec![("seen_id", Value::Bool(seen_id)), ("seen_key", Value::Bool(seen_key)), ("sig_valid", Value::Bool(sig_valid))])
}

fn admit_with(state: &Value, event: Value, facts: Value) -> Result<Value, String> {
    call("relay.admit", Value::obj(vec![("event", event), ("facts", facts), ("keys", keys()), ("now", Value::Int(NOW)), ("state", state.clone())]))
}

fn admit_ok(state: &Value, event: Value) -> Value {
    admit_with(state, event, facts(true, false, false)).expect("admitted")
}

fn genesis() -> Value {
    call("relay.genesis", Value::obj(vec![])).unwrap().get("state").cloned().unwrap()
}

fn mail_event(name: &str) -> Value {
    let drafted = call(
        "relay.mirror",
        Value::obj(vec![
            ("keys", keys()),
            ("mail", Value::obj(vec![
                ("box", Value::str("to-x1")),
                ("bytes", Value::Int(12)),
                ("name", Value::str(name)),
                ("observed_at_s", Value::Int(NOW - 5)),
                ("sha256", Value::str(digest_hex(name.as_bytes()))),
            ])),
            ("source", Value::str("mail")),
        ]),
    )
    .unwrap();
    signed(K1, drafted.get("draft").unwrap())
}

fn signed(pubkey: &str, draft: &Value) -> Value {
    let tags = draft
        .get("tags")
        .and_then(Value::as_array)
        .unwrap()
        .iter()
        .map(|row| strings_of(row).unwrap().into_iter().map(str::to_string).collect())
        .collect();
    event(
        pubkey,
        draft.get("created_at").and_then(Value::as_int).unwrap(),
        draft.get("kind").and_then(Value::as_int).unwrap(),
        tags,
        draft.get("content").and_then(Value::as_str).unwrap(),
    )
}

fn head_event(state: &Value, now: i64) -> Value {
    let head = call("relay.head", Value::obj(vec![("now", Value::Int(now)), ("state", state.clone())])).unwrap();
    signed(K1, head.get("draft").unwrap())
}

#[test]
fn sha256_matches_fips_180_vectors() {
    assert_eq!(digest_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert_eq!(digest_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert_eq!(
        digest_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
}

fn mth(entries: &[[u8; 32]]) -> [u8; 32] {
    match entries.len() {
        0 => sha256(&[]),
        1 => merkle_leaf(&entries[0]),
        n => {
            let split = 1usize << (usize::BITS - (n - 1).leading_zeros() - 1);
            merkle_node(&mth(&entries[..split]), &mth(&entries[split..]))
        }
    }
}

#[test]
fn frontier_root_is_the_rfc6962_tree_hash() {
    let entries: Vec<[u8; 32]> = (0u8..40).map(|index| sha256(&[index])).collect();
    let mut frontier = Vec::new();
    assert_eq!(frontier_root(&frontier), sha256(&[]));
    for size in 1..=entries.len() {
        frontier_push(&mut frontier, &entries[size - 1]);
        assert_eq!(frontier_root(&frontier), mth(&entries[..size]), "size {size}");
        assert_eq!(frontier.len(), bit_length(size as i64));
    }
}

#[test]
fn nip01_id_matches_the_prime_vector() {
    let tags = vec![
        vec!["p".to_string(), K2.to_string()],
        vec!["text".to_string(), "雪\n\"\\\r\t\u{8}\u{c}".to_string()],
    ];
    let id = event_id(K1, 1_700_000_000, 1, &tags, "Hello 雪\n\"\\\r\t\u{8}\u{c}\u{2028}\u{2029}").unwrap();
    assert_eq!(id, "8385f36767cb8f74ec41ad8dd4f058722604519cd5b5d67659021fc01fcfbeaf");
    assert_eq!(event_id(K1, 1, 1, &[], "bell\u{7}"), Err("EVENT_CONTROL"));
    assert_eq!(event_id(K1, 1, 1, &[], &"a".repeat(MAX_EVENT_BYTES)), Err("EVENT_TOO_LARGE"));
}

#[test]
fn head_content_round_trips_the_c3_format() {
    let mut state = State::genesis();
    state.push(&digest_hex(b"one")).unwrap();
    state.push(&digest_hex(b"two")).unwrap();
    let content = head_content(&state);
    assert!(content.starts_with("{\"hash\":\""));
    assert!(content.ends_with(",\"sequence\":2,\"treeSize\":2}"));
    assert_eq!(parse_head(&content).map(|head| head.size), Some(2));
    assert!(parse_head(&content.replace("\"sequence\":2", "\"sequence\":02")).is_none());
    assert!(parse_head(&content.replace("\"treeSize\":2", "\"treeSize\":3")).is_none());
    assert!(parse_head(&content.replace(LEAF_CONVENTION, "other")).is_none());
}

#[test]
fn admits_mirrors_and_witnesses_a_log() {
    let state = genesis();
    let first = admit_ok(&state, mail_event("001.md"));
    assert_eq!(first.get("authority").and_then(Value::as_str), Some("none"));
    assert_eq!(first.get("seq").and_then(Value::as_int), Some(1));
    assert_eq!(first.get("head_due"), Some(&Value::Bool(true)));
    let state = first.get("state").cloned().unwrap();
    let head = head_event(&state, NOW);
    let witnessed = admit_ok(&state, head.clone());
    let state = witnessed.get("state").cloned().unwrap();
    assert_eq!(state.get("size").and_then(Value::as_int), Some(2));
    assert_eq!(state.get("head").and_then(|head| head.get("size")).and_then(Value::as_int), Some(1));
    // The same head again is a duplicate id, and a stale copy no longer matches the root.
    assert_eq!(admit_with(&state, head.clone(), facts(true, true, false)), Err("EVENT_DUPLICATE".into()));
    let stale = signed(K1, &Value::obj(vec![
        ("content", Value::str(head.get("content").and_then(Value::as_str).unwrap())),
        ("created_at", Value::Int(NOW + 1)),
        ("kind", Value::Int(KIND_HEAD)),
        ("tags", Value::Array(vec![tag("d", HEAD_IDENTIFIER)])),
    ]));
    assert_eq!(admit_with(&state, stale, facts(true, false, false)), Err("HEAD_MISMATCH".into()));
}

#[test]
fn refuses_forged_and_authority_events() {
    let state = genesis();
    let good = mail_event("002.md");
    assert_eq!(admit_with(&state, good.clone(), facts(false, false, false)), Err("EVENT_SIGNATURE_INVALID".into()));
    assert_eq!(admit_with(&state, good.clone(), facts(true, false, true)), Err("MIRROR_DUPLICATE".into()));
    let mut tampered = good.clone();
    if let Value::Object(map) = &mut tampered {
        map.insert("created_at".into(), Value::Int(NOW - 4));
    }
    assert_eq!(admit_with(&state, tampered, facts(true, false, false)), Err("EVENT_ID_MISMATCH".into()));
    // A mirror kind signed by a principal instead of the witness.
    let drafted = good.clone();
    let as_x1 = event(
        K2,
        drafted.get("created_at").and_then(Value::as_int).unwrap(),
        KIND_MAIL,
        drafted.get("tags").and_then(Value::as_array).unwrap().iter().map(|row| strings_of(row).unwrap().into_iter().map(str::to_string).collect()).collect(),
        "",
    );
    assert_eq!(admit_with(&state, as_x1, facts(true, false, false)), Err("AUTHOR_ROLE".into()));
    for kind in AUTHORITY_KINDS {
        let forged = event(K1, NOW, kind, rows(&[("grant", "grant-1")]), "");
        assert_eq!(admit_with(&state, forged, facts(true, false, false)), Err("KIND_AUTHORITY".into()), "kind {kind}");
    }
    assert_eq!(admit_with(&state, event(K1, NOW, 1, vec![], "hi"), facts(true, false, false)), Err("KIND_UNKNOWN".into()));
    assert_eq!(admit_with(&state, event("ff".repeat(32).as_str(), NOW, KIND_MAIL, vec![], ""), facts(true, false, false)), Err("AUTHOR_UNKNOWN".into()));
    assert_eq!(admit_with(&state, event(K1, NOW + 61, KIND_HEAD, rows(&[("d", HEAD_IDENTIFIER)]), ""), facts(true, false, false)), Err("EVENT_FUTURE".into()));
    assert_eq!(admit_with(&state, event(K1, NOW, KIND_HEAD, rows(&[("d", HEAD_IDENTIFIER)]), ""), facts(true, false, false)), Err("HEAD_EMPTY".into()));
}

#[test]
fn kira_notes_travel_verbatim_only_when_shareable() {
    let tags = rows(&[("lane", "finding"), ("privacy", "builders")]);
    let note_event = event(K2, NOW - 30, KIND_NOTE, tags.clone(), "cache bug");
    let stored = |event: &Value| {
        let mut map = object(event).unwrap().clone();
        map.remove("content");
        Value::Object(map)
    };
    let note = |privacy: &str, event: Value, quarantined: bool| {
        Value::obj(vec![
            ("author", Value::str("x1")),
            ("created_at_s", Value::Int(NOW - 30)),
            ("event", event),
            ("id", Value::str(digest_hex(b"note"))),
            ("lane", Value::str("finding")),
            ("privacy", Value::str(privacy)),
            ("quarantined", Value::Bool(quarantined)),
            ("statement", Value::str("cache bug")),
            ("statement_hash", Value::str(digest_hex(b"statement"))),
        ])
    };
    let mirror = |note: Value| call("relay.mirror", Value::obj(vec![("keys", keys()), ("note", note), ("source", Value::str("kira"))]));
    let verbatim = mirror(note("builders", stored(&note_event), false)).unwrap();
    assert_eq!(verbatim.get("mode").and_then(Value::as_str), Some("verbatim"));
    assert_eq!(verbatim.get("event"), Some(&note_event));
    // The store raised it to local through its sources: a reference, no text, no statement hash.
    let local = mirror(note("local", stored(&note_event), false)).unwrap();
    assert_eq!(local.get("mode").and_then(Value::as_str), Some("draft"));
    let draft = local.get("draft").unwrap();
    assert_eq!(draft.get("content").and_then(Value::as_str), Some(""));
    let text = String::from_utf8(encode(draft)).unwrap();
    assert!(!text.contains("cache bug") && !text.contains(&digest_hex(b"statement")));
    assert!(text.contains(&note_event.get("id").and_then(Value::as_str).unwrap().to_string()));
    // Quarantined or store-signed notes are references too.
    assert_eq!(mirror(note("builders", stored(&note_event), true)).unwrap().get("mode").and_then(Value::as_str), Some("draft"));
    assert_eq!(mirror(note("public", Value::Null, false)).unwrap().get("mode").and_then(Value::as_str), Some("draft"));
    // The relay itself refuses a plaintext note that is not labelled shareable.
    let state = genesis();
    let private = event(K2, NOW, KIND_NOTE, rows(&[("privacy", "local")]), "secret");
    assert_eq!(admit_with(&state, private, facts(true, false, false)), Err("PRIVATE_PLAINTEXT".into()));
    let unlabelled = event(K2, NOW, KIND_NOTE, rows(&[("lane", "finding")]), "secret");
    assert_eq!(admit_with(&state, unlabelled, facts(true, false, false)), Err("PRIVATE_PLAINTEXT".into()));
    assert_eq!(admit_with(&state, note_event.clone(), facts(true, false, false)).map(|ok| ok.get("seq").cloned()), Ok(Some(Value::Int(1))));
    // The witness never writes memory.
    let by_witness = event(K1, NOW, KIND_NOTE, tags, "cache bug");
    assert_eq!(admit_with(&state, by_witness, facts(true, false, false)), Err("AUTHOR_ROLE".into()));
}

#[test]
fn check_detects_rollback_and_fork() {
    let mut state = genesis();
    for name in ["001.md", "002.md", "003.md"] {
        state = admit_ok(&state, mail_event(name)).get("state").cloned().unwrap();
    }
    let head = head_event(&state, NOW);
    let after = admit_ok(&state, head.clone()).get("state").cloned().unwrap();
    let check = |state: &Value, retained: Value, seq: Value| {
        call(
            "relay.check",
            Value::obj(vec![
                ("keys", keys()),
                ("retained", retained),
                ("retained_seq", seq),
                ("state", state.clone()),
                ("torn", Value::Bool(false)),
            ]),
        )
    };
    let retained = Value::obj(vec![("event", head.clone()), ("facts", facts(true, false, false))]);
    let verdict = |result: Result<Value, String>| result.map(|ok| ok.get("verdict").and_then(Value::as_str).unwrap().to_string());
    assert_eq!(verdict(check(&after, retained.clone(), Value::Int(4))), Ok("ok".into()));
    assert_eq!(verdict(check(&after, Value::Null, Value::Null)), Ok("refresh".into()));
    assert_eq!(verdict(check(&genesis(), Value::Null, Value::Null)), Ok("fresh".into()));
    // Truncated to the witnessed prefix or before it.
    assert_eq!(verdict(check(&state, retained.clone(), Value::Null)), Err("ROLLBACK".into()));
    // Rewritten: a longer log that no longer holds the retained head.
    let mut forked = state.clone();
    for name in ["004.md", "005.md"] {
        forked = admit_ok(&forked, mail_event(name)).get("state").cloned().unwrap();
    }
    assert_eq!(verdict(check(&forked, retained.clone(), Value::Null)), Err("FORK".into()));
    let unsigned = Value::obj(vec![("event", head), ("facts", facts(false, false, false))]);
    assert_eq!(verdict(check(&after, unsigned, Value::Int(4))), Err("HEAD_INVALID".into()));
}

#[test]
fn query_applies_nip01_filters() {
    let entry = |seq: i64, id: &str, pubkey: &str, kind: i64, at: i64, tags: &[(&str, &str)]| {
        Value::obj(vec![
            ("created_at", Value::Int(at)),
            ("id", Value::str(digest_hex(id.as_bytes()))),
            ("kind", Value::Int(kind)),
            ("pubkey", Value::str(pubkey)),
            ("seq", Value::Int(seq)),
            ("tags", Value::Array(tags.iter().map(|(name, value)| tag(name, value)).collect())),
        ])
    };
    let entries = Value::Array(vec![
        entry(1, "a", K1, KIND_MAIL, 100, &[("t", "mail")]),
        entry(2, "b", K1, KIND_RECEIPT, 200, &[("t", "grant")]),
        entry(3, "c", K3, KIND_LANE, 300, &[("t", "lane")]),
        entry(4, "d", K1, KIND_RECEIPT, 300, &[("t", "permit")]),
    ]);
    let query = |filters: Vec<Value>| {
        call("relay.query", Value::obj(vec![("entries", entries.clone()), ("filters", Value::Array(filters))]))
            .map(|ok| ok.get("seqs").and_then(Value::as_array).unwrap().iter().map(|seq| seq.as_int().unwrap()).collect::<Vec<_>>())
    };
    let filter = |pairs: Vec<(&str, Value)>| Value::obj(pairs);
    assert_eq!(query(vec![filter(vec![])]), Ok(vec![if digest_hex(b"c") < digest_hex(b"d") { 3 } else { 4 }, if digest_hex(b"c") < digest_hex(b"d") { 4 } else { 3 }, 2, 1]));
    assert_eq!(query(vec![filter(vec![("kinds", Value::Array(vec![Value::Int(KIND_RECEIPT)]))])]), Ok(vec![4, 2]));
    assert_eq!(query(vec![filter(vec![("authors", Value::Array(vec![Value::str(K3)]))])]), Ok(vec![3]));
    assert_eq!(query(vec![filter(vec![("#t", Value::Array(vec![Value::str("grant"), Value::str("mail")]))])]), Ok(vec![2, 1]));
    assert_eq!(query(vec![filter(vec![("since", Value::Int(200)), ("until", Value::Int(200))])]), Ok(vec![2]));
    assert_eq!(query(vec![filter(vec![("kinds", Value::Array(vec![Value::Int(KIND_RECEIPT)])), ("limit", Value::Int(1))])]), Ok(vec![4]));
    assert_eq!(
        query(vec![filter(vec![("authors", Value::Array(vec![Value::str(K3)]))]), filter(vec![("#t", Value::Array(vec![Value::str("mail")]))])]),
        Ok(vec![3, 1])
    );
    assert_eq!(query(vec![filter(vec![("search", Value::str("x"))])]), Err("FILTER_UNKNOWN".into()));
    assert_eq!(query(vec![filter(vec![("kinds", Value::Array(vec![]))])]), Err("FILTER_INVALID".into()));
    assert_eq!(query(vec![filter(vec![("ids", Value::Array(vec![Value::str("abc")]))])]), Err("FILTER_INVALID".into()));
    assert_eq!(query(vec![filter(vec![("limit", Value::Int(0))])]), Err("FILTER_INVALID".into()));
}

#[test]
fn ledger_receipts_hash_free_text_and_carry_no_task() {
    let record = Value::obj(vec![
        ("at", Value::str("2026-10-26T10:00:00.000Z")),
        ("grant", Value::obj(vec![
            ("effects", Value::Array(vec![Value::str("file.edit")])),
            ("expiresAt", Value::str("2026-10-26T18:00:00.000Z")),
            ("objective", Value::str("owner's private task text")),
            ("paths", Value::Array(vec![Value::str("dsh-plugin-desktop/**")])),
            ("permitBudget", Value::Int(800)),
        ])),
        ("grantId", Value::str("grant-1")),
        ("kind", Value::str("grant")),
        ("receipt", Value::str(digest_hex(b"receipt"))),
        ("taskId", Value::str("task-1")),
    ]);
    let drafted = call(
        "relay.mirror",
        Value::obj(vec![("at_s", Value::Int(NOW)), ("keys", keys()), ("record", record), ("source", Value::str("ledger"))]),
    )
    .unwrap();
    let text = String::from_utf8(encode(&drafted)).unwrap();
    assert!(!text.contains("private task") && !text.contains("dsh-plugin-desktop/**"));
    assert_eq!(drafted.get("sign_as").and_then(|signer| signer.get("role")).and_then(Value::as_str), Some("witness"));
    let state = admit_ok(&genesis(), signed(K1, drafted.get("draft").unwrap()));
    assert_eq!(state.get("seq").and_then(Value::as_int), Some(1));
}

#[test]
fn child_permits_mirror_with_their_child_and_attempt_prefix() {
    let record = |child: Option<&str>, attempt: &str, kind: &str| {
        let mut pairs = vec![
            ("at", Value::str("2026-10-26T10:00:00.000Z")),
            ("attemptId", Value::str(attempt)),
            ("callDigest", Value::str(digest_hex(b"call"))),
            ("grantId", Value::str("grant-1")),
            ("kind", Value::str(kind)),
            // Every row the chained ledger writes names its predecessor.
            ("prev", Value::str(digest_hex(b"previous row"))),
            ("receipt", Value::str(digest_hex(b"receipt"))),
            ("taskId", Value::str("task-1")),
        ];
        if let Some(child) = child {
            pairs.push(("childGrantId", Value::str(child)));
        }
        call(
            "relay.mirror",
            Value::obj(vec![("at_s", Value::Int(NOW)), ("keys", keys()), ("record", Value::obj(pairs)), ("source", Value::str("ledger"))]),
        )
    };
    let child = "grant-1:schedule:session-1";
    let drafted = record(Some(child), "grant-1:schedule:session-1|call-1", "permit").unwrap();
    let text = String::from_utf8(encode(&drafted)).unwrap();
    assert!(text.contains("[\"child\",\"grant-1:schedule:session-1\"]"), "{text}");
    let state = admit_ok(&genesis(), signed(K1, drafted.get("draft").unwrap()));
    assert_eq!(state.get("seq").and_then(Value::as_int), Some(1));
    // A child of another grant, an attempt without the child prefix, or a
    // child on a non-permit row is refused.
    assert!(record(Some("grant-2:schedule:session-1"), "grant-2:schedule:session-1|call-1", "permit").is_err());
    assert!(record(Some(child), "call-1", "permit").is_err());
    assert!(record(Some(child), "grant-1:schedule:session-1|call-1", "refuse").is_err());
    // The c1-era row (child attempt, no childGrantId) and a plain permit still mirror.
    assert!(record(None, "grant-1:delegated:c|call-1", "permit").is_ok());
    assert!(record(None, "call-1", "permit").is_ok());
    assert!(record(None, "a|b|c", "permit").is_err());
}

#[test]
fn owner_decisions_are_witness_receipts_without_words() {
    let decide = |pairs: Vec<(&str, Value)>| {
        call("relay.mirror", Value::obj(vec![("decision", Value::obj(pairs)), ("keys", keys()), ("source", Value::str("owner"))]))
    };
    let at = || ("at_ms", Value::Int(NOW * 1000 + 999));
    let shown = decide(vec![at(), ("card", Value::str("card-1")), ("decision", Value::str("shown")), ("tool", Value::str("git_push"))]).unwrap();
    assert_eq!(shown.get("sign_as").and_then(|signer| signer.get("role")).and_then(Value::as_str), Some("witness"));
    let draft = shown.get("draft").unwrap();
    assert_eq!(draft.get("kind").and_then(Value::as_int), Some(KIND_OWNER));
    assert_eq!(draft.get("created_at").and_then(Value::as_int), Some(NOW));
    let approved = decide(vec![
        at(),
        ("card", Value::str("card-1")),
        ("decision", Value::str("approved")),
        ("grant", Value::str("grant-1")),
        ("x", Value::str(digest_hex(b"decision"))),
    ])
    .unwrap();
    let stop = decide(vec![at(), ("decision", Value::str("stop")), ("grant", Value::str("grant-1"))]).unwrap();
    let declined = decide(vec![at(), ("card", Value::str("card-2")), ("decision", Value::str("declined")), ("reason", Value::str("closed-or-expired"))]).unwrap();
    // Only an approval names the digest and the grant; free text never becomes a tag.
    assert_eq!(decide(vec![at(), ("card", Value::str("card-1")), ("decision", Value::str("approved")), ("x", Value::str(digest_hex(b"d")))]), Err("MIRROR_INVALID".into()));
    assert_eq!(decide(vec![at(), ("card", Value::str("card-2")), ("decision", Value::str("declined")), ("reason", Value::str("Peter said no"))]), Err("MIRROR_INVALID".into()));
    assert_eq!(decide(vec![at(), ("card", Value::str("card-3")), ("decision", Value::str("stop"))]), Err("MIRROR_INVALID".into()));
    assert_eq!(decide(vec![at(), ("decision", Value::str("grant"))]), Err("MIRROR_INVALID".into()));
    assert_eq!(decide(vec![at(), ("decision", Value::str("stop")), ("objective", Value::str("words"))]), Err("MIRROR_INVALID".into()));
    let mut state = genesis();
    for drafted in [&shown, &approved, &declined, &stop] {
        let admitted = admit_ok(&state, signed(K1, drafted.get("draft").unwrap()));
        state = admitted.get("state").cloned().unwrap();
    }
    // Witness only, and the combination rule holds at admission too.
    assert_eq!(admit_with(&state, signed(K2, stop.get("draft").unwrap()), facts(true, false, false)), Err("AUTHOR_ROLE".into()));
    let forged = event(K1, NOW, KIND_OWNER, rows(&[("t", "approved"), ("card", "card-9"), ("i", &format!("{PREFIX_OWNER}{}", digest_hex(b"k")))]), "");
    assert_eq!(admit_with(&state, forged, facts(true, false, false)), Err("TAG_COMBINATION".into()));
}

#[test]
fn lane_results_are_signed_by_their_lane() {
    let run = |lane: &str| {
        Value::obj(vec![
            ("changed", Value::Array(vec![Value::str("dsh-plugin-desktop/src/a.ts")])),
            ("commits", Value::Array(vec![Value::str("a".repeat(40))])),
            ("duration_ms", Value::Int(65_000)),
            ("exit_code", Value::Int(0)),
            ("lane", Value::str(lane)),
            ("merged", Value::Bool(false)),
            ("outcome", Value::str("ok")),
            ("run_id", Value::str("run-1")),
            ("started_at_s", Value::Int(NOW - 100)),
            ("summary", Value::str("done")),
            ("task", Value::str("fix the cache")),
        ])
    };
    let mirror = |lane: &str| call("relay.mirror", Value::obj(vec![("keys", keys()), ("run", run(lane)), ("source", Value::str("lane"))]));
    let drafted = mirror("claude").unwrap();
    assert_eq!(drafted.get("sign_as").and_then(|signer| signer.get("name")).and_then(Value::as_str), Some("lane/claude"));
    assert_eq!(drafted.get("draft").and_then(|draft| draft.get("created_at")).and_then(Value::as_int), Some(NOW - 35));
    assert_eq!(mirror("codex"), Err("SIGNER_UNKNOWN".into()));
    let state = genesis();
    assert!(admit_with(&state, signed(K3, drafted.get("draft").unwrap()), facts(true, false, false)).is_ok());
    assert_eq!(admit_with(&state, signed(K1, drafted.get("draft").unwrap()), facts(true, false, false)), Err("AUTHOR_ROLE".into()));
}

#[test]
fn replay_stops_at_the_first_refusal() {
    let events = Value::Array(vec![
        Value::obj(vec![("event", mail_event("001.md")), ("facts", facts(true, false, false))]),
        Value::obj(vec![("event", mail_event("002.md")), ("facts", facts(false, false, false))]),
        Value::obj(vec![("event", mail_event("003.md")), ("facts", facts(true, false, false))]),
    ]);
    let result = call("relay.replay", Value::obj(vec![("events", events), ("keys", keys()), ("state", genesis())])).unwrap();
    assert_eq!(result.get("at").and_then(Value::as_int), Some(1));
    assert_eq!(result.get("refused").and_then(Value::as_str), Some("EVENT_SIGNATURE_INVALID"));
    assert_eq!(result.get("state").and_then(|state| state.get("size")).and_then(Value::as_int), Some(1));
}

#[test]
fn state_and_keys_are_validated() {
    let bad_state = Value::obj(vec![
        ("frontier", Value::Array(vec![])),
        ("head", Value::Null),
        ("last", Value::str(digest_hex(b"x"))),
        ("size", Value::Int(1)),
    ]);
    assert_eq!(admit_with(&bad_state, mail_event("001.md"), facts(true, false, false)), Err("STATE_INVALID".into()));
    let shared = Value::obj(vec![
        ("principals", Value::Array(vec![Value::obj(vec![("name", Value::str("x1")), ("pubkey", Value::str(K1))])])),
        ("witness", Value::str(K1)),
    ]);
    let result = call(
        "relay.admit",
        Value::obj(vec![("event", mail_event("001.md")), ("facts", facts(true, false, false)), ("keys", shared), ("now", Value::Int(NOW)), ("state", genesis())]),
    );
    assert_eq!(result, Err("KEYS_INVALID".into()));
    for name in ["owner", "peter/x", "lane", "Bad", "a/b/c/d"] {
        assert!(!principal_name(name), "{name}");
    }
}
