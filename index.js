module.exports = DataBaseSession;
var onHeaders = require('on-headers');
var extend = require('util')._extend;

var Request = require('http').IncomingMessage.prototype;
var hasOwn = Object.prototype.hasOwnProperty;
var console = new Logger('SESSION');

function DataBaseSession(database, _options){
	if(!database){
		throw new Error('database-session: first argument (database) is required.');
	}
	
	var options = {
		cookie: {}
	};
	
	if(_options){
		extend(options, _options);
		if(hasOwn.call(_options, 'cookie')){
			options.cookie = extend({}, _options.cookie)
		}
	}
	var COOKIE = options.cookie;
	/* parse options finish */
	
	options.query = new AV.Query(database);
	options.constructor = typeof database == 'string'? AV.Object.extend(database) : database;
	
	var autoStart = options.autoStart = hasOwn.call(options, 'autoStart')? !!options.autoStart : false;
	options.name = hasOwn.call(options, 'name')? options.name : 'NODESESSID';
	options.requestVarName = hasOwn.call(options, 'requestVarName')? options.requestVarName : 'session';
	
	COOKIE.path = COOKIE.path || '/';
	COOKIE.domain = COOKIE.domain || undefined;
	COOKIE.signed = COOKIE.signed === undefined? true : COOKIE.signed;
	COOKIE.secure = COOKIE.secure || false;
	COOKIE.httponly = COOKIE.httponly === undefined? true : COOKIE.httponly;
	if(hasOwn.call(COOKIE, 'maxAge')){
		COOKIE.maxAge = 1000*60*60*24*COOKIE.maxAge;
		if(isNaN(COOKIE.maxAge)){
			throw new Error('database-session: COOKIE.maxAge must be a number (in days).');
		}
	}
	
	return function (req, rsp, next){
		if(req[options.requestVarName]){
			console.error('database-session: session is already created.');
			return next();
		}
		req[options.requestVarName] = new Session(req, rsp, options);
		
		if(autoStart){
			req[options.requestVarName].sessionStart().then(next, next);
		} else{
			next();
		}
	};
}

function Session(req, rsp, options){
	Object.defineProperty(this, '_options', {
		value       : {
			response   : rsp,
			request    : req,
			config     : options,
			started    : false,
			query      : options.query,
			constructor: options.constructor,
			signed     : options.cookie.signed
		},
		enumerable  : false,
		configurable: false
	});
}

Session.prototype = {
	inspect : function (){
		return '[LeanDatabaseSession ' + (this._options.started? 'Started' : 'NotInit') +
		       ' #' + this._options.name + ']';
	},
	toJSON  : function (){
		return {};
	},
	toString: function (){
		return '[Object SessionData]';
	},
	raw    : function (){
		var ret = {};
		for(var i in this){
			if(hasOwn.call(this, i)){
				ret[i] = this[i];
			}
		}
		return ret;
	}
};

Session.prototype.sessionFlushCookie = function sessionFlush(force){
	var options = this._options;
	if(options.response.headersSent){
		throw new Error('database-session: you can\'t flush cookie after response headers sent');
	}
	if(!options.isCookieExists || force){
		options.response.cookie(options.config.name, options.name, options.config.cookie);
		options.isCookieExists = true;
	}
};
Session.prototype.sessionFlush = function sessionFlush(){
	var options = this._options;
	if(!options.started){
		throw new Error('database-session: session not start.');
	}
	var result = sessionChanged(this);
	if(options.isNew){
		result.set('key', options.name);
		this.sessionFlushCookie();
	}
	
	if(!result){
		return;
	}
	result.set('lastActive', new Date);
	
	// console.log('sess flush isNew=%s isCookieExists=%s', options.isNew, options.isCookieExists)
	result.save().then(undefined, function (err){
		console.error('database-session: flush database failed with error: ' + (err.stack || err.message || err));
	});
};

Session.prototype.sessionDestroy = function sessionDestroy(noDestroyCookie){
	var options = this._options;
	if(!options.started){
		return;
	}
	options.started = false;
	delete options.name;
	
	for(var i in this){
		if(hasOwn.call(this, i)){
			delete this[i];
		}
	}
	if(options.response.headersSent){
		options.object.destroy(undefined, function (err){
			console.error('database-session: destroy after header sent failed with error: ' +
			              (err.stack || err.message || err));
		});
		options.object = null;
	} else if(options.isCookieExists && !noDestroyCookie){
		options.response.cookie(options.config.name, '', {expires: new Date(0)});
		options.isCookieExists = false;
	}
};

Session.prototype.sessionStart = function sessionStart(newId){
	var self = this;
	var options = self._options;
	if(!options.request.cookies){
		throw new Error('database-session: `cookie-parser` must be used before database session.');
	}
	
	if(options.signed){
		options.name = options.request.signedCookies[options.config.name];
	} else{
		options.name = options.request.cookies[options.config.name];
	}
	options.isCookieExists = !!options.name;
	
	if(newId && options.started && options.name != newId){
		self.sessionDestroy(true);
	}
	if(options.response.headersSent){
		throw new Error('database-session: you can\'t create new session or change sessionId after response headers sent');
	}
	
	return new Promise(function (resolve, reject){
		if(options.started){
			return resolve();
		}
		onHeaders(options.response, function setHeaders(){
			if(!options.started){
				return; // may destroy before send
			}
			try{
				self.sessionFlush();
			} catch(e){
				console.error('database-session: save failed with error: ' + (e.stack || e.message || e));
			}
		});
		
		if(newId){
			options.name = newId;
		}
		
		if(options.name){
			var q = options.query;
			q.equalTo('key', options.name);
			q.first(resolver, function (e){
				console.error(e);
				reject(e)
			});
		} else{
			createRandonString(function (e, key){
				if(e){
					throw e;
				} else{
					options.name = key;
					resolver(false);
				}
			});
		}
		
		function resolver(dbObj){
			if(dbObj){
				options.isNew = false;
				var keyNameMap = dbObj.get('keyNameMap');
				
				for(var dbField in dbObj.attributes){
					if(hasOwn.call(dbObj.attributes, dbField)){
						var userKey = keyNameMap[dbField];
						if(userKey && !hasOwn.call(self, userKey)){
							self[userKey] = dbObj.attributes[dbField];
						}
					}
				}
			} else{
				dbObj = new options.constructor;
				dbObj.set('keyNameMap', {});
				options.isNew = true;
			}
			// console.log('isNew=%s, objectId=%s', options.isNew, dbObj.id)
			options.object = dbObj;
			options.started = true;
			
			resolve();
		}
	});
};

/* support functions */
var valid_field_name = /^[a-zA-Z0-9_]*$/;
var not_valid_field_chars = /[^a-zA-Z0-9_]+/g;
function mapKey(map, key){
	var kn;
	for(kn in map){
		if(map[kn] === key){
			return kn;
		}
	}
	var dbField = key.replace(not_valid_field_chars, function (m){
		return new Buffer(m).toString('hex');
	});
	kn = 'sess_' + dbField;
	map[kn] = key;
	return kn;
}

function createRandonString(cb){
	require('crypto').randomBytes(35, function (e, buf){
		if(e){
			cb(e);
		} else{
			cb(undefined, buf.toString('hex') + parseInt(Math.random()*1000000).toString());
		}
	});
}

function sessionChanged(sess){
	var walkedNames = {}, dbField, changed = false;
	
	var original = sess._options.object._serverData;
	var result = new sess._options.constructor;
	
	result.id = sess._options.object.id;
	var keyMap = sess._options.object.get('keyNameMap');
	result.set('keyNameMap', keyMap);
	
	for(var i in sess){
		if(!hasOwn.call(sess, i) || sess[i] === null){
			continue;
		}
		
		dbField = mapKey(keyMap, i);
		walkedNames[dbField] = true;
		var newValue = sess[i], oldValue = original[dbField];
		
		if(oldValue === undefined){
			result.set(dbField, newValue);
			changed = true;
		} else if(newValue instanceof AV.Object){
			if(newValue.id != oldValue.id){
				if(newValue.id && newValue._opSetQueue.length === 0){
					result.set(dbField, newValue);
				} else{
					throw new Error('database-session: field "' + i + '" not saved before flush.');
				}
				changed = true;
			}
		} else if(typeof newValue === 'object'){
			if(JSON.stringify(newValue)
			   != JSON.stringify(oldValue)){
				result.set(dbField, newValue);
				changed = true;
			}
		} else if(newValue !== oldValue){
			result.set(dbField, newValue);
			changed = true;
		}
	}
	
	for(dbField in original){ // remove deleted keys
		if(!hasOwn.call(original, dbField)){
			continue;
		}
		if(walkedNames[dbField]){
			continue;
		}
		if(!keyMap[dbField]){
			continue;
		}
		delete keyMap[dbField];
		result.unset(dbField);
		changed = true;
	}
	// console.log('changed=%s', changed, result)
	return changed? result : false;
}
