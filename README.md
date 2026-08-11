<div align="center">
    <h1><b>Docmost OEM Customization</b></h1>
    <p>
        A public source fork of Docmost with ONLYOFFICE and MCP customizations.
        <br />
        <a href="https://docmost.com"><strong>Website</strong></a> | 
        <a href="https://docmost.com/docs"><strong>Documentation</strong></a> |
        <a href="https://github.com/docmost/docmost"><strong>Upstream</strong></a>
    </p>
</div>
<br />

## About this fork

This repository is based on Docmost `v0.95.0`
(`4132dd59be05a507dad76d1e01c48c9af2fd90f0`) and keeps local business
customizations on the `onlyoffice-integration` branch. The goal is to keep the
upstream Docmost code recognizable while isolating OEM-specific behavior under
dedicated integration modules where possible.

The source repository is intended to be public to satisfy the open-source
distribution obligations of Docmost's AGPL-licensed code. Deployment images may
still be published to private registries for operational use, but users who
receive or access the running AGPL-covered application must be able to obtain the
corresponding source code for this fork.

## Supported customizations

### ONLYOFFICE online editing

- Supports authenticated online editing for `.docx`, `.xlsx`, and `.pptx`
  attachments.
- Opens supported attachments in a separate editor route.
- Uses short-lived signed URLs for Document Server file reads.
- Validates callback JWTs and signed callback tokens.
- Saves edited files through Docmost's existing storage abstraction.
- Preserves attachment ID, filename, page relationship, and download URL.
- Keeps unsupported formats on the original download behavior.

See [integrations/onlyoffice/README.md](integrations/onlyoffice/README.md) for
configuration, storage behavior, mount points, smoke tests, and rollback notes.

### Model Context Protocol server

This fork also exposes Docmost as an MCP server at `POST /mcp`, authenticated by
personal API keys created in Docmost.

Current MCP release: `mcp-v1.3.4`

Supported MCP capabilities include:

- Page and space reads: `search_pages`, `get_page`, `list_pages`,
  `list_child_pages`, `get_space`, `list_spaces`.
- Attachment reads: `search_attachments`, `get_attachment`,
  `download_attachment`, `list_page_attachments`.
- Page and comment writes: `create_page`, `update_page`, `move_page`,
  `create_comment`.
- Space writes: `create_space`, `update_space`, `delete_space`.
- Attachment writes: `upload_attachment`, `replace_attachment`,
  `delete_attachment`, `create_page_with_attachments`.
- Editor-node insertion: `insert_attachment_node`, `insert_image_node`, and
  `upload_attachment` with `insertIntoPage` plus `display`.

Destructive tools are explicitly marked with `destructiveHint: true`, and all
operations reuse Docmost page, space, workspace, and attachment permission checks.

See [integrations/mcp/README.md](integrations/mcp/README.md) for the full tool
list, annotations, authentication model, deployment record, and smoke test.

## Custom image

The deployed v1.3.4 image built from this fork is:

```text
andrew988/docmost-onlyoffice:mcp-v1.3.4
```

Its source tag in this repository is:

```text
mcp-v1.3.4
```

Do not deploy a floating `latest` tag for this customization. Use immutable tags
and keep the corresponding source tag available.

## Getting started

For upstream Docmost usage, refer to the official
[Docmost documentation](https://docmost.com/docs). For this fork, start with the
two integration documents linked above and the Compose files in this repository.

## Features

This fork keeps the upstream Docmost feature set, including:

- Real-time collaboration
- Diagrams (Draw.io, Excalidraw and Mermaid)
- Spaces
- Permissions management
- Groups
- Comments
- Page history
- Search
- File attachments
- Embeds (Airtable, Loom, Miro and more)
- Translations (10+ languages)
- OEM ONLYOFFICE online editing for supported Office attachments
- OEM MCP server for AI/client integrations

### Screenshots

<p align="center">
<img alt="home" src="https://docmost.com/screenshots/home.png" width="70%">
<img alt="editor" src="https://docmost.com/screenshots/editor.png" width="70%">
</p>

### License

Docmost core is licensed under the open-source AGPL 3.0 license.
This fork preserves that license for AGPL-covered code and publishes the
corresponding source changes in this repository.

Enterprise features are available under an enterprise license (Enterprise Edition).

All files in the following directories are licensed under the Docmost Enterprise license defined in `packages/ee/License`.
  - apps/server/src/ee
  - apps/client/src/ee
  - packages/ee

This fork modifies a small number of upstream-owned files to mount the OEM
integrations. Those files and the reason for each modification are documented in
the integration README files.

### Contributing

See the upstream [development documentation](https://docmost.com/docs/self-hosting/development).

## Thanks
Special thanks to;

<img width="100" alt="Crowdin" src="https://github.com/user-attachments/assets/a6c3d352-e41b-448d-b6cd-3fbca3109f07" />

[Crowdin](https://crowdin.com/) for providing access to their localization platform.


<img width="48" alt="Algolia-mark-square-white" src="https://github.com/user-attachments/assets/6ccad04a-9589-4965-b6a1-d5cb1f4f9e94" />

[Algolia](https://www.algolia.com/) for providing full-text search to the docs.
