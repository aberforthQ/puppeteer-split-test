const express = require('express');
const redis = require('redis').createClient();
const mysql = require('mysql').createConnection({
	host: 'localhost',
	user: 'webtest',
	password: '!WebTest(12', // No worries :-)
	database: 'webtest'
});

const app = express();

redis.on('connect', () => {
	console.log('Redis connected');
	redis.del('queue');	
});
redis.on('error', (err) => console.log('Redis error: ' + err));

app.disable('etag');


function addToQueue(job){
	redis.lpush.apply(redis, ['queue', JSON.stringify(job)]);
}

function log(data){
	console.log((new Date()).toTimeString(), data);
}

function urlIsValid(url){
	if( !url.startsWith('http') ){
		return false;
	}
	var notAllowedUrlParts = ['webtest.app', 'file://', 'localhost', '127.0.0.1', '::1'];
	for( n in notAllowedUrlParts ){
		if( url.indexOf(notAllowedUrlParts[n]) >= 0 && url.indexOf(notAllowedUrlParts[n]) <= 10 ){
			return false;
		}
	}
	return true;
}

// we want POST, but you need more deps with bodyparse stuff which sucks
app.get('/service/add', (req, res) => {
	var url = req.query.parm.trim();
	if( !urlIsValid(url) ){
		res.send({status: 'error'});
		return;
	}
	redis.get('A-' + url, (error, result) => {
		if( error || !result ){
			log('Add ' + url);
			addToQueue({
				time: Date.now(),
				url: url,
				status: 'queued'
			});
		}
	});
	res.send({status: 'queued'});
});
app.get('/service/status', (req, res) => {
	//console.log('A-' + req.query.parm);
	var url = req.query.parm.trim();
	if( !urlIsValid(url) ){
		res.send({status: 'error'});
		return;
	}
	redis.get('A-' + url, (error, result) => {
		//console.log(error, result);
		if( error || !result ){
			redis.lrange('queue', 0, -1, (error, items) => {
				if( error || !items || items.length == 0 ){
					res.send({status: 'queued'});
					return;
				}
				for( i in items ){
					if( JSON.parse(items[i]).url == url ){
						res.send(items[i]);
						return;
					}
				}
			});
			return;
		}
		res.send(result);	
	});
});

app.get('/service/list', (req, res) => {
	mysql.query("SELECT urls.url, tv.variant, tv.requests, tv.cookies FROM urls INNER JOIN tests ON tests.url_id = urls.id INNER JOIN tests_variants tv ON tv.test_id = tests.id WHERE urls.url LIKE 'https://%' ORDER BY urls.id ASC LIMIT " + Math.round(Math.random() * 2000) + ",100", (error, result) => {
		var urls = {};
		for( r in result ){
			var row = result[r];

			if( row.url.indexOf('x') >= 1 || row.url.indexOf('127') >= 1 || row.url.indexOf('porn') >= 1 ){
				continue;
			}

			if( urls[row.url] == undefined ){
				urls[row.url] = {};
			}
			urls[row.url][row.variant] = {requests: row.requests, cookies: row.cookies};
		}
		res.send(urls);
	});	
});

const ENV = process.argv[2] || 'dev';

var port = null;

if( ENV == 'prod' ){
	port = 3000;
} else if( ENV == 'dev' ){
	port = 3001;
} else {
	console.log('Unknown ENV, exiting..');
	process.exit(1);
}

app.listen(port, 'localhost', () => console.log('Express running on port', port));
