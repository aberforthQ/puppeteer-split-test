<?php

if( !isset($_GET['action']) ){
	exit;
}

if( $_GET['action'] == 'status' ){
	echo file_get_contents('http://127.0.0.1:3000/status?parm=' . urlencode($_GET['parm']));
} else if( $_GET['action'] == 'add' ){
	echo file_get_contents('http://127.0.0.1:3000/add/?parm=' . urlencode($_GET['parm']));
}

