# DexBot

A white-label product built on [FrockBot](https://github.com/timoconnellaus/frockbot) from its published packages, as described in FrockBot's [ADR 0038](https://github.com/timoconnellaus/frockbot/blob/main/docs/adr/0038-white-label-deployments.md). Not a fork: this repository holds only DexBot's deployment profile, brand, auth Package (Privy) and client application.

The client application is [`app/`](app/README.md): a thin Flutter application that runs FrockBot's `frockbot_client` package with DexBot's brand.
