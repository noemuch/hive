# Spec: CQRS/ES substrate for the tenancy domain

**Status:** draft — **Audience:** product management + platform leadership (review by end of week)

## Executive summary

This document proposes a CQRS/ES substrate with snapshot coalescence and DDD aggregate boundary enforcement for the tenancy bounded context, replacing the current CRUD-on-RDBMS topology. We will leverage an event-sourced aggregate root with a projection fan-out through Kafka Streams into materialized read models, using a vertically-sliced hexagonal architecture with ports/adapters to decouple the domain core from infrastructure concerns. Read-side consistency will be tunable via a saga orchestration layer that compensates eventually-consistent reads via idempotent command retries against the write-side aggregate.

## Background

The current implementation exhibits anemic domain model symptoms: tenancy mutation logic is scattered across service-layer transaction scripts rather than encapsulated in rich domain objects. Invariant enforcement is impedance-mismatched against the relational schema, resulting in aggregate-boundary leakage into the persistence layer. The domain has accreted technical debt in the form of tangled aggregate roots where billing, membership, and entitlement concerns share transactional boundaries with tenant metadata, violating the single-writer principle at the aggregate level. Additionally, the lack of an event stream precludes temporal queries, CDC-based projections, and replayable state reconstruction.

## Proposed substrate

### Write-side

The write-side will be implemented as an event-sourced aggregate root (the Tenant aggregate) with commands dispatched through a command bus. Commands are validated against current aggregate state (loaded by replaying events from a snapshot + tail), then emitted events are persisted to an event store (EventStore DB, not Kafka directly, for ACID guarantees on the write path). Snapshots are coalesced every N events to bound aggregate load time.

Aggregate invariants are enforced in the domain core using a specification-pattern predicate DSL. The aggregate exposes no getters — it is manipulated exclusively through commands that return domain events, following the Evans/Vernon DDD playbook. Pessimistic concurrency is handled via optimistic-concurrency-control over the expected event version.

### Read-side

Read-side projections are derived from the event stream via a Kafka Streams topology that fans out to materialized views in Postgres (query-optimized, denormalized), Elasticsearch (full-text), and Redis (low-latency lookups). Each projector is idempotent and replayable; projector state is bookmarked via offset management so new projections can be backfilled from stream-start without coordination.

Consistency mode per read is tunable: a query can opt into read-your-writes consistency via a session token that blocks until the projection has caught up to the command's resulting event offset, or opt into eventual consistency for high-throughput queries.

### Saga orchestration

Cross-aggregate workflows (e.g., tenant-creation → billing-account-creation → default-workspace-creation) are coordinated via a saga orchestrator implementing the choreography-based long-running-process pattern, with compensating commands for rollback on partial failure. Sagas are themselves event-sourced for auditability and replayability.

## Technology selection rationale

- **EventStore DB** over Kafka for the write-side: write-side requires linearizable ordering guarantees per aggregate stream, which Kafka's partition-key-based ordering provides only probabilistically under rebalance conditions. EventStore offers strict per-stream ordering with stream-level OCC primitives.
- **Kafka Streams** over Flink for the projection layer: our operational footprint already includes Kafka, and the topology primitives (KTable, KStream, state stores) map naturally to the projection model without the operational overhead of a Flink cluster.
- **Axon Framework** for the command-side scaffolding: provides command bus, event bus, aggregate lifecycle, and snapshot management out of the box, obviating the need to roll our own CQRS plumbing.

## Hexagonal layering

The tenancy bounded context will be structured as a hexagonal architecture with a pure-domain core, an application layer for command/query handlers, and adapter ports for persistence, messaging, and external integrations. This preserves the testability of the domain core via the classicist TDD approach and permits swapping infrastructure adapters without touching domain logic.

## Migration

Strangler-fig pattern against the existing CRUD endpoints. The new CQRS substrate runs in parallel with the legacy path; traffic is gradually cut over via a routing shim. Dual-write is handled via an anti-corruption layer between the legacy model and the new aggregate. After 100% cutover, the legacy path is decommissioned.

## Risks

Accidental complexity is the primary risk vector. We mitigate this through strict bounded-context boundaries, clear aggregate identity rules, and a commitment to not extend CQRS/ES beyond the tenancy context without an additional architectural decision record.

## Ask

Approval to begin substrate scaffolding in sprint 14. Full rollout estimated at 8 sprints pending dependency resolution on the Kafka cluster provisioning and the Axon framework license procurement.
