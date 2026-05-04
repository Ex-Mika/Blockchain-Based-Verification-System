# UCI Adult Credentials

Transformed from the public UCI Adult dataset into the frontend's Merkle-tree credential shape.

Source:
- UCI Adult dataset: https://archive.ics.uci.edu/dataset/2/adult
- License: CC BY 4.0

Generated record count: 48842

Output files:
- `adult-credentials-full.json`: full transformed dataset
- `adult-credentials-sample-2048.json`: first 2,048 records for easier frontend testing
- `adult-credentials-5.json`: first 5 transformed records
- `adult-credentials-10.json`: first 10 transformed records
- `adult-credentials-100.json`: first 100 transformed records
- `adult-credentials-1000.json`: first 1,000 transformed records
- `adult-credentials-2000.json`: first 2,000 transformed records
- `adult-credentials-10000.json`: first 10,000 transformed records

Credential mapping:
- `holderName`: deterministic synthetic generic name for demo verification
- `credentialTitle`: human-readable credential title derived from education level
- `recipient`: deterministic synthetic Ethereum-style address derived from the source row
- `credentialId`: sequential synthetic identifier
- `achievementCode`: derived from education and income label
- `issueDate`: deterministic synthetic issue date
- `issuerId`: `uci-adult-dataset`