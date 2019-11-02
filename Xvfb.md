`apt-get install xvfb`
`apt-get install imagemagick`

```
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
echo 'deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main' | sudo tee /etc/apt/sources.list.d/google-chrome.list
```

```
sudo apt-get update
apt-get install google-chrome-stable
```

```
// This does not work
xvfb-run -a --server-args="-screen 0 1280x800x24 -ac -nolisten tcp -dpi 96 +extension RANDR" google-chrome
```

```
// This does
Xvfb :0 & export DISPLAY=:0 & google-chrome
```

```
DISPLAY=0 google-chrome "https://thenextweb.com/hardfork/2019/09/03/nice-firefox-69-now-blocks-cryptominers-and-tracking-cookies-by-default/" --load-extension=chrome-extensions/ublock-origin
```

```
DISPLAY=:0 import -window root test.png
```

```
Xvfb :0 & export DISPLAY=:0 & google-chrome "https://www.techradar.com/news/eight-ways-to-reduce-and-offset-your-digital-carbon-footprint" --remote-debugging-port=9222
```