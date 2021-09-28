# scan.datasatsto.se
A QR code scanning and reporting API for SQL/Data Saturday conferences

# What is it

Back in the day when we used to have SQL Saturdays, attendees would have QR codes that they could scan
in vendor booths. Event organizers could download a database extract from the SQL Saturday site with all
scans, and send that extract to each respective exhibitor.

This is a framework to
- Create QR codes as inline HTML data objects
- Register when a QR code is scanned
- Report scanned QR codes
- Cleanse expired data

## Privacy

The solution works with integer identities, so it does not contain any personally identifiable information.
This means that you'll have to connect those IDs to your attendee records yourself.

No IP addresses, locations, etc are used or checked or stored.

The solution does not use passwords, with the exception of the EventSecret, which administrators need to
extract reporting data.

# Setup

You'll need:
- A web server that runs NodeJS, for example IIS or Azure WebApps.
- A SQL Server instance, any edition.

To set up:
- Deploy the Git repository in the web root.
- You may have to use npm to install all of the dependencies. An Azure Web App does this for you.
- Run the database deployment script in a blank SQL Server database. The entire solution runs in its own
  schema, so it will probably play nice with other apps if you need to.
- Create a user to the SQL Server database. It can be a contained user (without login) if you want.
- GRANT EXECUTE ON SCHEMA::Scan TO {database user};
- Set up environment variables to allow the web app to connect to SQL Server.

Environment variables:

- dbserver: Fully qualified name of the database instance
- dbname: Database name
- dblogin: Login name
- dbpassword: Password

**Note** The app currently only supports SQL Authentication.

# API Reference

## Add a new event

Not supported in the API.

```
EXECUTE Scan.New_Event @Event;
```

The stored procedure returns an "EventSecret", which acts like a password to access event data.

## Add a new identity (attendee)

`/new/{event code}`

Creates a new identity for an existing event.

Return value:
```
{ "id":"19380729426",
  "url":"https://www.example.com/19380729426",
  "imgsrc":"https://www.example.com/eventcode/19380729426.png",
  "data":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJ..."}
```

## Scan a code

`/{identity}[{code}]`

Scans the identity. Code is optional, and can be added to re-use the identity
for multiple purposes/exhibitors/etc. Remember that the QR URL only contains
the identity, not the code.

Displays a very brief status to the user to indicate if the scan was successful.

Returns HTTP/200 if successful, 500 if not.

## Retrieve a list of scans

`/report/{secret}`

Returns a JSON report of all identities, whether scanned or not. If the identity was
not scanned, the "Scanned" property is blank.

Example:
```
[{"ID":"19380729426","Scanned":null,"Code":null},
 {"ID":"17560301726","Scanned":"2021-09-27T18:12:23.509Z","Code":null},
 {"ID":"17560301726","Scanned":"2021-09-27T18:12:26.852Z","Code":null},
 {"ID":"17560301726","Scanned":"2021-09-27T18:13:08.743Z","Code":null},
 {"ID":"17560301726","Scanned":"2021-09-27T18:13:17.322Z","Code":null},
 {"ID":"17560301726","Scanned":"2021-09-27T18:13:43.244Z","Code":null},
 {"ID":"17560301726","Scanned":"2021-09-27T18:15:34.198Z","Code":"Vendor 1"},
 {"ID":"17560301726","Scanned":"2021-09-27T18:15:39.511Z","Code":null},
 {"ID":"17560301726","Scanned":"2021-09-27T18:17:13.824Z","Code":"Vendor 2"},
 {"ID":"17560301726","Scanned":"2021-09-27T18:18:36.513Z","Code":"Vendor 2"},
 {"ID":"17560301726","Scanned":"2021-09-27T18:18:42.966Z","Code":"Lunch ticket"}]
```

## Expire

`/expire`

Evicts all events, identities and scans that have expired. By default, an event expires
365 days after its creation.
