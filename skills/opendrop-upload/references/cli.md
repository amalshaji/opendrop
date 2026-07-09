# OpenDrop Upload CLI Examples

```bash
opendrop whoami
opendrop upload ./dist
opendrop upload ./dist --slug launch
opendrop upload ./dist --namespace team-docs --slug launch --visibility private
opendrop upload ./site.zip --json
```

Successful output includes:

- latest URL: `https://host.example/ns/slug`
- version URL: `https://host.example/ns/slug/versions/ver_...`
