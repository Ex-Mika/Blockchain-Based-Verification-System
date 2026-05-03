# UCI Adult Credentials

Transformed from the public UCI Adult dataset into the frontend's Merkle-tree credential shape.

Source:
- UCI Adult dataset: https://archive.ics.uci.edu/dataset/2/adult
- License: CC BY 4.0

Generated record count: 48842

Output files:
- `adult-credentials-full.json`: full transformed dataset
- `adult-credentials-sample-2048.json`: first 2,048 records for easier frontend testing

Credential mapping:
- `recipient`: deterministic synthetic Ethereum-style address derived from the source row
- `credentialId`: sequential synthetic identifier
- `achievementCode`: derived from education and income label
- `issueDate`: deterministic synthetic issue date
- `issuerId`: `uci-adult-dataset`