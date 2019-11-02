/*
 * Due to memory issues with puppeteer, and because all this async stuff makes
 * garbage collection hard, this process runs ONCE for one job in the queue.
 * After the jobs in Chrome and Chrome with uBlock Origin are finished, the process is quit
 * Xvfb is killed, so is Chrome, and thus also puppeteer.
 * Another process should restart this, so the next item in the queue is picked
 */

const puppeteer = require('puppeteer-core');
const redis = require('redis').createClient();
const { spawn } = require('child_process');

const ENV = process.argv[2] || 'dev';

var displays, puppeteerPorts;

if( ENV == 'prod' ){
	displays = [0,1];
	puppeteerPorts = [9992,9993];
} else if( ENV == 'dev' ){
	displays = [2,3];
	puppeteerPorts = [9994,9995];
} else {
	console.log('Unknown ENV, exiting..');
	process.exit(1);
}

var redisThrottle = null;
function log(url, browser, data, data2){
	if( data2 == undefined ){
		data2 = '';
	}
	if( results[url] == undefined ){
		results[url] = {};
	}
	if( results[url][browser] == undefined ){
		results[url][browser] = {};
	}

	results[url][browser][data] = data2;
	console.log((new Date()).toTimeString(), browser, url, data, data2);

	clearTimeout(redisThrottle);
	redisThrottle = setTimeout(() => {
		redis.set('A-' + url, JSON.stringify(results[url]));
	}, 50);
}

function delay(ms) {
	return new Promise(r => setTimeout(r, ms));
}

var browsers = {};
var results = {};

function navigate(url){
	console.log('navigate', url);
	results[url] = {};
	for( b in browsers ) {
		results[url][b] = {init: true};
		connect(b, browsers[b], url);

		setTimeout(() => {
			// always end after one minute
			forceShutdown(url);
		}, 60000);
	}
}

function humanize(value, type){
	if( value < 0 ){
		return {value: value, human: '0'};
	}
	if( type == undefined ){
		return {value: value, human: value};
	}
	if( type == 's' ){
		return {value: value, human: (value / 1000).toFixed(2) + ' s'};
	}
	if( type == 'mb' ){
		return {value: value, human: (value / 1024 / 1024).toFixed(2) + ' MB'};
	}
	return {value: value, human: value};
}

function cleanup(){
	spawn('killall', ['chrome']);
	spawn('killall', ['google-chrome']);
	spawn('killall', ['Xvfb']);
}

var childProcesses = [];
function initXvfb(){
	// spawn two Xvfb's
	childProcesses.push(spawn('Xvfb', [':' + displays[0]]));
	childProcesses.push(spawn('Xvfb', [':' + displays[1]]));
}

function spawnBrowser(browserName, path, params, shellEnv, callback){
	var prog = spawn(path, params, {env: shellEnv});

	childProcesses.push(prog);

	prog.stdout.on('data', (data) => {
		//log(browserName, data.toString());
	});

	prog.stderr.on('data', (data) => {
		//console.log(data.toString());
		if( data.toString().indexOf('DevTools listening on') == -1 ){
			return;
		}
		var wsEndpoint = data.toString().replace('DevTools listening on', '').trim();
		console.log(browserName, wsEndpoint);
		browsers[browserName] = wsEndpoint;
		callback(browserName);	
	});

	console.log(browserName, 'Launched');
}

function popFromQueue(){
	redis.brpop('queue', 1, (error, job) => {
		//console.log('Check job', error, job);
		if( error || !job ){
			delay(500).then(popFromQueue);
			return;
		}
		console.log(JSON.parse(job[1]));
		navigate(JSON.parse(job[1]).url);
	});
}

process.on('SIGTERM', () => {
	console.log('Exiting');
	for( c in childProcesses ){
		childProcesses[c].kill();
	}
});


cleanup();
initXvfb();

var spawnParams = [
	'--remote-debugging-port=PORT',
	'--user-data-dir=tmp-dir-0',
	'--no-first-run',
	'--incognito',
	//'--media-cache-size=1',
	//'--disk-cache-size=1',
	'--disable-gpu'
];

var slowStartTimeout = setTimeout(() => {
	if( spawnCount < 2 ){
		console.log('Too slow. exit..');
		cleanup();
		process.exit(1);
	}
}, 10000);

var spawnCount = 0;
function isSpawned(){
	spawnCount++;
	if( spawnCount >= 2 ){
		clearTimeout(slowStartTimeout);
		popFromQueue();
	}
}
function forceShutdown(url){
	for( b in browsers ){
		log(url,b, 'Done', 'Done');
	}
	setTimeout(() => {
		cleanup();
		process.exit(0);
	}, 1000);

}
function isEnded(url){
	spawnCount--;
	if( spawnCount <= 0 ){
		forceShutdown(url);
	}
}

spawnParams[0] = spawnParams[0].replace('PORT', puppeteerPorts[0]);
spawnBrowser('Normal', 'google-chrome', spawnParams, {DISPLAY: ':' + displays[0]}, isSpawned);

spawnParams[0] = spawnParams[0].replace(puppeteerPorts[0], puppeteerPorts[1]);
spawnParams[1] = spawnParams[1].replace('-0', '-1');
spawnParams.push('--load-extension=../../chrome-extensions/ublock-origin')

spawnBrowser('uBlock', 'google-chrome', spawnParams, {DISPLAY: ':' + displays[1]}, isSpawned);

function connect(browserName, wsEndpoint, url){
	puppeteer.connect({
		browserWSEndpoint: wsEndpoint
	}).then(async browser => {

		const page = await browser.newPage();

		page.setViewport({width: 1680, height: 952});
		page.setCacheEnabled(false);

		await page._client.send('Network.clearBrowserCookies');
		await page._client.send('Network.clearBrowserCache');

		//page.once('error', (title, error) => log(url, browserName, 'Error', error));

		/*await page.tracing.start({
			path: browserName + '-trace.json', 
			//categories: ['devtools.timeline']
		});*/

		var advanced = {};

		var requestsBlocked = 0;
		page.on('requestfailed', (err) => {
			if( err._failureText == 'net::ERR_BLOCKED_BY_CLIENT' ){
				requestsBlocked++;
				log(url, browserName, 'Blocked requests', humanize(requestsBlocked));
			}
			//log(url, browserName, err._failureText + ' ' + err._url);
		});

		var cookieInterval = setInterval(async () => {
			//var cookies = await page.cookies();
			//log(url, browserName, 'Cookies', humanize(cookies.length));
			var metrics = await page._client.send('Performance.getMetrics');
			for( m in metrics ){
				if( metrics[m].name == 'Frames' ){
					log(url, browserName, 'iFrames', humanize(metrics[m].value));
				}
			}

			var allCookies = await page._client.send('Network.getAllCookies');

			//log(url, browserName, 'dCookies', allCookies.cookies);

			if( allCookies && allCookies.cookies ){
				var cookieDomains = {};
				for( c in allCookies.cookies ){
					var domain = allCookies.cookies[c].domain.replace(/^\./, '');
					if( cookieDomains[domain] == undefined ){
						cookieDomains[domain] = 0;
					}
					cookieDomains[domain]++;
				}

				log(url, browserName, 'Cookies', humanize(allCookies.cookies.length));
				
				log(url, browserName, 'CookieDomains', cookieDomains);
			}

		}, 1000);	
	
		function hasEnded(){
			log(url, browserName, 'Done', 'Done');
			clearTimeout(noResponsesReceivedTimeout);
			clearInterval(cookieInterval);
			page.close();
			isEnded(url);
		}

		page.once('close', () => {
			browser.disconnect();
		});

		// end this job if no request came in in the last 4 seconds
		var requestCounter = 0;
		var totalSize = 0;
		var noResponsesReceivedTimeout = null;
		var isLoaded = false;
		page.on('response', (res) => {
			//console.log(res);
			if( res.status() >= 200 && res.status() <= 399 ){
				/*res.buffer().then(buffer => {
					totalSize += buffer.length;
				});*/
				/*if( res._headers['content-length'] !== undefined ){
					totalSize += parseInt(res._headers['content-length'], 10);
				}*/
				requestCounter++;
				log(url, browserName, 'Requests', humanize(requestCounter));
				//log(url, browserName, 'Page size', humanize(totalSize, 'mb'));
			}
			if( isLoaded ){
				clearTimeout(noResponsesReceivedTimeout);
				noResponsesReceivedTimeout = setTimeout(hasEnded, 2000);
			}
		});

		var totalBytes = 0;
		page._client.on('Network.dataReceived', (event) => {
			totalBytes += event.encodedDataLength;
			log(url, browserName, 'Page size', humanize(totalBytes, 'mb'));
		});

		page.on('pagerror', (err) => {
			log(url, browserName, 'Past error', err);
		});

		log(url, browserName, 'Navigate', url);
		var timeBefore = Date.now();
		page.once('load', () => {
			log(url, browserName, 'Page loaded!');

			var timeAfter = Date.now();
			log(url, browserName, 'Load time',  humanize(timeAfter - timeBefore, 's'));	
	
			// Stop everything after 20 seconds
			setTimeout(hasEnded, 20000);
			isLoaded = true;
			
			// make a screenshot after 1 second
			delay(1000).then(() => {
				var screenshotPath = '/screenshots/' + Date.now() + '-' + (Math.random() + '').substring(2) + '-' + browserName + '.png';
				page.screenshot({path: 'public' + screenshotPath}).then(() => {
					log(url, browserName, 'Screenshot', screenshotPath);
				});
			});
		});

		try {
			await page.goto(url);
		} catch(err){
			//console.error(err);
		}
		
		const timing = JSON.parse(
			await page.evaluate(() => JSON.stringify(window.performance.timing))
		);
		log(url, browserName, 'Timings', timing);
	
		let performanceMetrics = await page._client.send('Performance.getMetrics');
		log(url, browserName, 'AllMetrics', performanceMetrics.metrics);

		var metrics = {};

		for( m in performanceMetrics.metrics ){
			metrics[performanceMetrics.metrics[m].name] = performanceMetrics.metrics[m].value;
		}
				
		log(url, browserName, 'Metrics', metrics);
		log(url, browserName, 'ProcessingTime', humanize(timing.loadEventEnd - timing.domLoading, 's'));
		log(url, browserName, 'DomContentLoaded', humanize(timing.domContentLoadedEventStart - timing.navigationStart, 's'));
		log(url, browserName, 'Load time', humanize(timing.loadEventStart - timing.navigationStart, 's'));	
		
		log(url, browserName, 'iFrames', humanize(metrics.Frames));
			
		// auto consent accept:
					
		setTimeout(function(){
			try {
				// quantcast
				var frames = page.frames();
				var consentFrame = frames.find(f => f.name() === 'cmp-ui-iframe');
				consentFrame.$eval('#mainAgree', el => el.click() );

			} catch( err ){
			}
			try {
				// yahoo & partners
				page.$eval('button[name=agree]', el => el.click() );
			} catch( err ){
			}
			try {
				page.$eval('button.consent-accept-all', el => el.click() );
			} catch( err ){
			}
		}, 10);

		//const pageMetrics = await page.metrics();

		//log(url, browserName, 'page.metrics()', pageMetrics);

		//await browser.close();
	});
}
