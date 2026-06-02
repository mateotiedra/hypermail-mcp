# Graph Report - hyper-email-mcp-0  (2026-06-02)

## Corpus Check
- 54 files · ~29,839 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 643 nodes · 1315 edges · 30 communities (28 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2735309d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]

## God Nodes (most connected - your core abstractions)
1. `AccountRecord` - 72 edges
2. `AccountStore` - 27 edges
3. `OutlookProvider` - 24 edges
4. `GmailProvider` - 22 edges
5. `ImapProvider` - 21 edges
6. `FolderInfo` - 19 edges
7. `AgentStore` - 16 edges
8. `compilerOptions` - 15 edges
9. `SendInput` - 15 edges
10. `shouldRegister()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Provider Architecture (Outlook/IMAP/Gmail)` --uses--> `OAuth Device-Code Authentication Flow`  [INFERRED]
  AGENTS.md → README.md
- `OAuth Device-Code Authentication Flow` --enables--> `Lazy Server Lifecycle`  [INFERRED]
  README.md → AGENTS.md
- `Encryption Key Management (HYPERMAIL_MCP_KEY)` --secures--> `Account Store (Token Persistence)`  [INFERRED]
  docs/hosting.md → AGENTS.md
- `README Changelog Update Before Release` --updates--> `24-Tool Email API Catalog`  [INFERRED]
  .pi/prompts/updatenpm.md → README.md
- `HTTP Hosting Mode (Streamable HTTP)` --enables--> `Docker Deployment`  [INFERRED]
  README.md → docs/hosting.md

## Hyperedges (group relationships)
- **Unified Email API Surface** — readmemd_unified_email_surface, readmemd_tool_catalog, agentsmd_tool_handlers [INFERRED 0.85]
- **Server Security Posture** — readmemd_account_encryption, hostingmd_encryption_key_management, readmemd_read_only_mode, readmemd_per_tool_filtering [INFERRED 0.80]
- **Multi-Provider Routing Stack** — agentsmd_provider_architecture, readmemd_multi_provider_routing, readmemd_ms_graph_client, readmemd_msal_node [INFERRED 0.90]

## Communities (30 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (52): Registry, ProviderId, ResolvedTools, htmlToMarkdown(), selectBody(), turndown, markdownToHtml(), registerAccountTools() (+44 more)

### Community 1 - "Community 1"
Cohesion: 0.08
Nodes (9): GmailProvider, ImapProvider, mapFolder(), OutlookProvider, CompleteAddAccountResult, FolderInfo, ListFoldersOptions, SendInput (+1 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (49): extractTokens(), ImapClient, ImapClientFactory, ImapTokens, isImapTokens(), BodyNode, clampLimit(), decodeId() (+41 more)

### Community 3 - "Community 3"
Cohesion: 0.13
Nodes (14): bin, hypermail-mcp, description, engines, node, files, keywords, license (+6 more)

### Community 4 - "Community 4"
Cohesion: 0.20
Nodes (10): acquireAccessToken(), awaitDeviceCodeReady(), beginDeviceCode(), buildOAuth2Client(), DEFAULT_SCOPES, DeviceCodeBegin, isSerializedGmailTokens(), SerializedGmailTokens (+2 more)

### Community 6 - "Community 6"
Cohesion: 0.06
Nodes (57): GmailClientFactory, base64urlEncode(), buildRawMessage(), clampLimit(), findHeader(), GmailMessage, GmailMessageListEntry, GmailMessagePart (+49 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (23): Account Store (Token Persistence), Dev Workflow (edit→build→test→iterate), directTools Mode, hypermail-mcp Project Structure, Lazy Server Lifecycle, Provider Architecture (Outlook/IMAP/Gmail), Per-Tool Handler Implementations, tsup Build System (+15 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (17): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, lib, module, moduleResolution (+9 more)

### Community 9 - "Community 9"
Cohesion: 0.14
Nodes (13): files, code, document, image, paper, video, graphifyignore_patterns, needs_graph (+5 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (15): dataDir, http, enabled, host, port, clientId, tenantId, providers (+7 more)

### Community 11 - "Community 11"
Cohesion: 0.14
Nodes (13): dataDir, http, enabled, host, port, clientId, tenantId, providers (+5 more)

### Community 12 - "Community 12"
Cohesion: 0.50
Nodes (5): Docker Deployment, Reverse Proxy Compatibility, Session Management (Mcp-Session-Id), Streamable HTTP Transport, HTTP Hosting Mode (Streamable HTTP)

### Community 13 - "Community 13"
Cohesion: 0.40
Nodes (4): MS_CLIENT_ID, MS_TENANT_ID, hypermail, node

### Community 14 - "Community 14"
Cohesion: 0.50
Nodes (4): Markdown-to-HTML Conversion (marked), 24-Tool Email API Catalog, Zod Input Validation, README Changelog Update Before Release

### Community 17 - "Community 17"
Cohesion: 0.09
Nodes (30): Add-account flow (Outlook), Agent multi-tenancy, agents.yaml, As a hosted HTTP server, Claude Desktop / Claude Code, code:bash (npm install -g hypermail-mcp     # or pnpm / npx), code:jsonc ({), code:json ({) (+22 more)

### Community 18 - "Community 18"
Cohesion: 0.20
Nodes (9): code:block1 (src/), code:bash (pnpm build        # Compile TypeScript), Commands, Dev Workflow, Environment, hypermail-mcp, Key Dependencies, Purpose (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.20
Nodes (9): code:bash (HYPERMAIL_MCP_KEY=$(openssl rand -base64 32) \), code:dockerfile (FROM node:20-slim), code:bash (docker run -d -p 3000:3000 \), Docker (minimal), Hosting hypermail-mcp, Quick start, Read-only mode, Required environment (+1 more)

### Community 20 - "Community 20"
Cohesion: 0.06
Nodes (39): AgentDef, agentDefSchema, AgentsConfig, agentsConfigSchema, EmailAccountDef, emailAccountDefSchema, LiveReloadHandle, loadAgentsConfig() (+31 more)

### Community 24 - "Community 24"
Cohesion: 0.07
Nodes (28): GmailProviderOptions, OutlookProviderOptions, BuildRegistryOptions, ProvidersConfig, AccountStore, decrypt(), encrypt(), OpenOptions (+20 more)

### Community 25 - "Community 25"
Cohesion: 0.17
Nodes (11): acquireAccessToken(), awaitDeviceCodeReady(), beginDeviceCode(), buildPca(), DEFAULT_SCOPES, DeviceCodeBegin, isSerializedTokens(), makeConfig() (+3 more)

### Community 26 - "Community 26"
Cohesion: 0.15
Nodes (13): dependencies, @azure/msal-node, google-auth-library, googleapis, imapflow, isomorphic-fetch, js-yaml, marked (+5 more)

### Community 27 - "Community 27"
Cohesion: 0.06
Nodes (44): 1. Push to a Git repository, 2. Connect Git provider in Dokploy, 3. Create a Compose service, 4. Set environment variables, 4. Set required env var, 5. Add provider credentials (optional), 5. Deploy, 6. Deploy (+36 more)

### Community 29 - "Community 29"
Cohesion: 0.22
Nodes (9): scripts, build, dev, dev:http, prepublishOnly, start, test, test:watch (+1 more)

### Community 30 - "Community 30"
Cohesion: 0.25
Nodes (8): devDependencies, tsup, @types/isomorphic-fetch, @types/js-yaml, @types/node, @types/nodemailer, typescript, vitest

### Community 32 - "Community 32"
Cohesion: 0.67
Nodes (3): repository, type, url

## Knowledge Gaps
- **215 isolated node(s):** `target`, `module`, `moduleResolution`, `lib`, `outDir` (+210 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AccountRecord` connect `Community 1` to `Community 0`, `Community 2`, `Community 4`, `Community 6`, `Community 20`, `Community 24`, `Community 25`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **Why does `AccountStore` connect `Community 24` to `Community 0`, `Community 2`, `Community 4`, `Community 6`, `Community 20`, `Community 25`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `AgentStore` connect `Community 24` to `Community 0`, `Community 20`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `target`, `module`, `moduleResolution` to the rest of the system?**
  _215 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.0877431026684758 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.07676767676767676 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07086197778952935 - nodes in this community are weakly interconnected._