### Incompatible Records
You are attempting to combine records which are incompatible with each other. This may be:
- Attempting to combine CNAME with MX or TXT records. This is not possible unless you [proxy your subdomain](https://docs.is-a.dev/domain-structure/#-proxied-optional).
- Attempting to combine any records excluding DS records with NS records. This is also possible. Note that you may not create nested subdomains of a root subdomain with NS records!
