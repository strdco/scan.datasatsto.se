#!/usr/bin/env node



// Core modules:
const fs = require('fs');
const path = require('path');

// Other modules:
const express = require('express');
const cookieSession = require('cookie-session');

// HTTP port that the server will run on:
var serverPort=process.argv[2] || process.env.PORT || 3000;

// QR Code module:
const qr = require('qrcode'); // https://www.npmjs.com/package/qrcode

// The web server itself:
const app = express();
app.disable('etag');
app.disable('x-powered-by');
app.enable('trust proxy');

app.use(express.json());
app.use(express.urlencoded( { extended: true }));

app.use(cookieSession({
    name: 'session',
    secret: (process.env.cookieSecret || 'dev'),
    rolling: true,
    secure: !(serverPort==3000),        // on dev environment only, allow cookies even without HTTPS.
    sameSite: true,
    resave: true,
    maxAge: 24 * 60 * 60 * 1000         // 24 little hours
}));

// Tedious: used to connect to SQL Server:
const Connection = require('tedious').Connection;
const Request = require('tedious').Request;
const Types = require('tedious').TYPES;
const IsolationLevels = require('tedious').ISOLATION_LEVEL;

// Connection string to the SQL Database:
var connectionString = {
    server: process.env.dbserver,
    authentication: {
        type      : 'default',
        options   : {
            userName  : process.env.dblogin,
            password  : process.env.dbpassword
        }
    },
    options: { encrypt       : true,
               database      : process.env.dbname,
               connectTimeout : 20000,   // 20 seconds before connection attempt times out.
               requestTimeout : 30000,   // 20 seconds before request times out.
               rowCollectionOnRequestCompletion : true,
               dateFormat    : 'ymd',
               isolationLevel: IsolationLevels.SERIALIZABLE,
               connectionIsolationLevel : IsolationLevels.SERIALIZABLE,
               appName       : 'scan.datasatsto.se' // host name of the web server
        }
    };




/*-----------------------------------------------------------------------------
  Start the web server
-----------------------------------------------------------------------------*/

console.log('HTTP port:       '+serverPort);
console.log('Database server: '+process.env.dbserver);
console.log('Express env:     '+app.settings.env);
console.log('');

app.listen(serverPort, () => console.log('READY.'));




/*-----------------------------------------------------------------------------
  Default URL: returns a 404
  ---------------------------------------------------------------------------*/

app.get('/', function (req, res, next) {

    httpHeaders(res);

    var options = {
        root: __dirname + '/',
        dotfiles: 'deny',
        headers: {
            'x-timestamp': Date.now(),
            'x-sent': true
        }
    };

    res.status(404).send(createHTML('assets/error.html', { "Msg": "Nothing to see here." }));
    return;

});





/*-----------------------------------------------------------------------------
  Get QR code PNG file
  ---------------------------------------------------------------------------*/

app.get('/:dir/:id.png', function (req, res, next) {

    httpHeaders(res);

    var options = {
        maxAge: 24 * 60 * 60 * 1000,      // Cache the PNG for 24 hours.
        root: __dirname+'/qr/'+decodeURI(req.params.dir).toLowerCase()+'/',
        dotfiles: 'deny',
        headers: {
            'x-timestamp': Date.now(),
            'x-sent': true
        }
    };

    res.sendFile(decodeURI(req.params.id)+'.png', options, function(err) {
        if (err) {
            res.sendStatus(404);
            return;
        }
    });

});





/*-----------------------------------------------------------------------------
  Generate a new QR code:
  ---------------------------------------------------------------------------*/

app.get('/new/:event', function (req, res, next) {

    httpHeaders(res);

    // Name the connection after the host:
    connectionString.options.appName=req.headers.host;

    try {
        sqlQuery(connectionString, 'EXECUTE Scan.New_Identity @Event=@Event;',
        [{ "name": 'Event', "type": Types.VarChar, "value": decodeURI(req.params.event) }],

            async function(recordset) {
                if (recordset) {
                    // Fetch the new output ID from the stored procedure:
                    var id=recordset[0].ID;

                    // Create the /qr directory if it doesn't already exist
                    if (!fs.existsSync(__dirname+'/qr')) { fs.mkdirSync(__dirname+'/qr'); }

                    // Create the event directory if it doesn't already exist
                    var dir=__dirname+'/qr/'+decodeURI(req.params.event).toLowerCase();
                    if (!fs.existsSync(dir)) { fs.mkdirSync(dir); }

                    var url='https://'+req.headers.host+'/'+id;

                    // Create the file
                    qr.toFile(dir+'/'+id+'.png', url, (err) => {
                        if (err) {
                            res.status(500).send(createHTML('assets/error.html', { "Msg": "Couldn't create .png file." }));
                            return;
                        }

                        // Create the Base64 data blob
                        qr.toDataURL(url, (err, src) => {
                            if (err) {
                                res.status(500).send(createHTML('assets/error.html', { "Msg": "Couldn't create the data blob." }));
                                return;
                            }
    
                            // Return a successful response to the request:
                            res.status(200).json({
                                "id": id,
                                "url": url,
                                "imgsrc": 'https://'+req.headers.host+'/'+decodeURI(req.params.event.toLowerCase())+'/'+id+'.png',
                                "data": src
                            });
                        });
                    });


                } else {
                    res.status(401).send(createHTML('assets/error.html', { "Msg": "Invalid ID." }));
                }
            });
    } catch(err) {
        res.status(500).send(createHTML('assets/error.html', { "Msg": "There was a problem" }));
    }

});






/*-----------------------------------------------------------------------------
  Set up the scanning client:
  ---------------------------------------------------------------------------*/

app.get('/setup', function (req, res, next) {

    httpHeaders(res);

    if (req.query.id) {
        sqlQuery(connectionString, 'EXECUTE Scan.Get_Codes @ID=@ID;',
        [   { "name": 'ID', "type": Types.BigInt, "value": parseInt(req.query.id) }],

        async function(recordset) {
            var codes='';
            recordset.forEach(item => {
                codes+='<a href="/'+parseInt(req.query.id)+'/'+encodeURIComponent(item.ReferenceCode)+'">'+simpleHtmlEncode(item.ReferenceCode)+'</a>';
            });

            if (!codes) {
                res.status(500).send(createHTML('assets/error.html', { "Msg": "That code didn't look right." }));
                return;
            }

            res.status(200).send(createHTML('assets/select-code.html', { "codes": codes }));
            return;
        });
    } else {
        // This creates/renews a session cookie, used to create/maintain the user session:
        req.session.dummy=Date.now();        // Prevent the session from expiring.

        res.status(200).send(createHTML('assets/setup.html', { "Code": (req.session.vendorCode || "") }));
    }


});

app.post('/setup', function (req, res, next) {

    req.session.vendorCode = req.body.code;
    res.status(200).send(createHTML('assets/ok.html', { "Code": req.body.code }));

});










/*-----------------------------------------------------------------------------
  Scan a code:
  ---------------------------------------------------------------------------*/

app.get('/:id([0-9]*)/:code', newScan);
app.get('/:id([0-9]*)', newScan);

function newScan(req, res, next) {

    var referenceCode=decodeURI(req.params.code || '') || req.session.vendorCode || "";
    if (!referenceCode) {
        res.redirect('/setup?id='+parseInt(req.params.id));
        return;
    }

    httpHeaders(res);
    try {
        // Name the connection after the host:
        connectionString.options.appName=req.headers.host;

        sqlQuery(connectionString, 'EXECUTE Scan.New_Scan @ID=@ID, @ReferenceCode=@ReferenceCode;',
            [   { "name": 'ID', "type": Types.BigInt, "value": parseInt(req.params.id) },
                { "name": 'ReferenceCode', "type": Types.VarChar, "value": referenceCode }],

            async function(recordset) {
                if (recordset.length==1) {
                    // Set the exhibitor code to the one we're using now:
                    req.session.vendorCode = referenceCode;

                    res.status(200).send(createHTML('assets/ok.html', { "Code": (referenceCode || '(No exhibitor code)') }));
                    return;
                } else {
                    res.status(500).send(createHTML('assets/error.html', { "Msg": "That code didn't look right." }));
                    return;
                }
            });
    } catch(e) {
        res.status(500).send(createHTML('assets/error.html', { "Msg": "There was a problem." }));
        return;
    }

};





/*-----------------------------------------------------------------------------
  View all scans:
  ---------------------------------------------------------------------------*/

app.get('/report/:secret', function (req, res, next) {
    
      httpHeaders(res);
      try {
          // Name the connection after the host:
          connectionString.options.appName=req.headers.host;
  
          sqlQuery(connectionString, 'EXECUTE Scan.Get_Scans @EventSecret=@EventSecret;',
              [   { "name": 'EventSecret', "type": Types.UniqueIdentifier, "value": decodeURI(req.params.secret) }],
  
              async function(recordset) {
                res.status(200).json(recordset);
                return;
              });
      } catch(e) {
          res.status(500).send(createHTML('assets/error.html', { "Msg": "There was a problem." }));
          return;
      }
  
  });
  
  
  
  
  
/*-----------------------------------------------------------------------------
  View one random scan:
  ---------------------------------------------------------------------------*/

  app.get('/random/:code/:secret', function (req, res, next) {
    
    httpHeaders(res);
    try {
        // Name the connection after the host:
        connectionString.options.appName=req.headers.host;

        sqlQuery(connectionString, 'EXECUTE Scan.Get_Random @ReferenceCode=@ReferenceCode, @EventSecret=@EventSecret;',
            [   { "name": 'EventSecret', "type": Types.UniqueIdentifier, "value": decodeURI(req.params.secret) },
                { "name": 'ReferenceCode', "type": Types.NVarChar, "value": decodeURI(req.params.code) }],

            async function(recordset) {
              res.status(200).json(recordset);
              return;
            });
    } catch(e) {
        res.status(500).send(createHTML('assets/error.html', { "Msg": "There was a problem." }));
        return;
    }

});





/*-----------------------------------------------------------------------------
  Expire/evict old events from the database:
  ---------------------------------------------------------------------------*/

app.get('/expire', function (req, res, next) {

    var id=0;

    // Name the connection after the host:
    connectionString.options.appName=req.headers.host;

    try {
        sqlQuery(connectionString, 'EXECUTE Scan.Expire;', [],

        async function(recordset) {
            if (recordset) {
                recordset.forEach(item => {
                    console.log('Expired event: ' + item.ExpiredEvent);
                    var dir=__dirname+'/qr/'+item.ExpiredEvent.toLowerCase();
                    //fs.rmdirSync(dir, { recursive: true });

                    // Remove all the cached images in the directory.
                    removeDir(dir);
                });
            }
            res.status(200).send(createHTML('assets/ok.html', {}));
        });
    } catch(err) {
        res.status(500).send(createHTML('assets/error.html', { "Msg": "There was a problem" }));
    }

});


// Modified from: https://coderrocketfuel.com/article/remove-both-empty-and-non-empty-directories-using-node-js
// Recursively deletes files and directories in a path.
const removeDir = function(path) {
    if (fs.existsSync(path)) {
        const files = fs.readdirSync(path);
  
        files.forEach(function(filename) {
            if (fs.statSync(path + "/" + filename).isDirectory()) {
                removeDir(path + "/" + filename);
            } else {
                fs.unlinkSync(path + "/" + filename);
            }
        });

        fs.rmdirSync(path);
    }
}






/*-----------------------------------------------------------------------------
  Other related assets, like CSS or other files:
  ---------------------------------------------------------------------------*/

app.get('/assets/:asset', function (req, res, next) {

    httpHeaders(res);

    var options = {
        maxAge: 60 * 60 * 1000,         // Max age 1 hour (so we can cache stylesheets, etc)
        root: __dirname + '/assets/',
        dotfiles: 'deny',
        headers: {
            'x-timestamp': Date.now(),
            'x-sent': true
        }
    };

    res.sendFile(req.params.asset, options, function(err) {
        if (err) {
            res.sendStatus(404);
            return;
        }
    });
});









/*-----------------------------------------------------------------------------
  Canned SQL interface:
  ---------------------------------------------------------------------------*/

function sqlQuery(connectionString, statement, parameters, next) {
    // Connect:
    var conn = new Connection(connectionString);
    var rows=[];
    var columns=[];
    var errMsg;

    conn.on('infoMessage', connectionError);
    conn.on('errorMessage', connectionError);
    conn.on('error', connectionGeneralError);
    conn.on('end', connectionEnd);

    conn.connect(err => {
        if (err) {
            console.log(err);
            next();
        } else {
            exec();
        }
    });

    function exec() {
        var request = new Request(statement, statementComplete);

        parameters.forEach(function(parameter) {
            request.addParameter(parameter.name, parameter.type, parameter.value);
        });

        request.on('columnMetadata', columnMetadata);
        request.on('row', row);
        request.on('done', requestDone);
        request.on('requestCompleted', requestCompleted);
      
        conn.execSql(request);
    }

    function columnMetadata(columnsMetadata) {
        columnsMetadata.forEach(function(column) {
            columns.push(column);
        });
    }

    function row(rowColumns) {
        var values = {};
        rowColumns.forEach(function(column) {
            values[column.metadata.colName] = column.value;
        });
        rows.push(values);
    }

    function statementComplete(err, rowCount) {
        if (err) {
            console.log('Statement failed: ' + err);
            errMsg=err;
            next();
        } else {
            //console.log('Statement succeeded: ' + rowCount + ' rows');
        }
    }

    function requestDone(rowCount, more) {
        console.log('Request done: ' + rowCount + ' rows');
    }

    function requestCompleted() {
        //console.log('Request completed');
        conn.close();
        if (!errMsg) {
            next(rows);
        }
    }
      
    function connectionEnd() {
        //console.log('Connection closed');
    }

    function connectionError(info) {
        if (info.number!=5701 && info.number!=5703) {
            // 5701: Changed database context to...
            // 5703: Changed language setting to...
            console.log('Msg '+info.number + ': ' + info.message);
        }
    }

    function connectionGeneralError(err) {
        console.log('General database error:');
        console.log(err);
    }

}



function simpleHtmlEncode(plaintext) {
    var html=plaintext;
    html=html.replace('&', '&amp;');
    html=html.replace('<', '&lt;');
    html=html.replace('>', '&gt;');
    return(html);
}


/*-----------------------------------------------------------------------------
  Format an HTML template:
  ---------------------------------------------------------------------------*/

function createHTML(templateFile, values) {
    var rn=Math.random();

    // Read the template file:
    var htmlTemplate = fs.readFileSync(path.resolve(__dirname, './'+templateFile), 'utf8').toString();

    // Loop through the JSON blob given as the argument to this function,
    // replace all occurrences of <%=param%> in the template with their
    // respective values.
    for (var param in values) {
        if (values.hasOwnProperty(param)) {
            htmlTemplate = htmlTemplate.split('\<\%\='+param+'\%\>').join(values[param]);
        }
    }

    // Special parameter that contains a random number (for caching reasons):
    htmlTemplate = htmlTemplate.split('\<\%\=rand\%\>').join(rn);
    
    // Clean up any remaining parameters in the template
    // that we haven't replaced with values from the JSON argument:
    while (htmlTemplate.includes('<%=')) {
        param=htmlTemplate.substr(htmlTemplate.indexOf('<%='), 100);
        param=param.substr(0, param.indexOf('%>')+2);
        htmlTemplate = htmlTemplate.split(param).join('');
    }

    // DONE.
    return(htmlTemplate);
}




/*-----------------------------------------------------------------------------
  Set a bunch of standard HTTP headers:
  ---------------------------------------------------------------------------*/

function httpHeaders(res) {
/*
    // The "preload" directive also enables the site to be pinned (HSTS with Preload)
    const hstsPreloadHeader = 'max-age=31536000; includeSubDomains; preload'
    res.header('Strict-Transport-Security', hstsPreloadHeader); // HTTP Strict Transport Security with preload
*/
    // Limits use of external script/css/image resources
    res.header('Content-Security-Policy', "default-src 'self'; style-src 'self' fonts.googleapis.com; script-src 'self'; font-src fonts.gstatic.com");

    // Don't allow this site to be embedded in a frame; helps mitigate clickjacking attacks
    res.header('X-Frame-Options', 'sameorigin');

    // Prevent MIME sniffing; instruct client to use the declared content type
    res.header('X-Content-Type-Options', 'nosniff');

    // Don't send a referrer to a linked page, to avoid transmitting sensitive information
    res.header('Referrer-Policy', 'no-referrer');

    // Limit access to local devices
    res.header('Permissions-Policy', "camera=(), display-capture=(), microphone=(), geolocation=(), usb=()"); // replaces Feature-Policy

    return;
}

