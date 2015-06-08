# 利用 leancloud 数据库存放 session 的 express 中间件

lean-g-database-session

## 最新版本
0.0.3

## 安装方法

```sh
$ npm install cookie-parser lean-g-database-session
```

## 如何使用
##### 1.加载中间件

```javascript
var cookieSignKey = "secret string here";
app.use(require('cookie-parser')(cookieSignKey));

var sessionConfig = {
    name: 'NODESESSID',
    requestVarName: 'session'，
    autoStart: false,
    cookie:{
        path: '/',
        domain: undefiend,
        signed: true,
        secure: false,
        httponly: true,
        maxAge: 0
    }
};
var databaseName = 'SessionStorage';
app.use(require('lean-g-database-session')(databaseName, sessionConfig));
```
##### 2.创建数据库
本例中数据库名为 SessionStorage。去后台创建SessionStorage数据库，不需要进行任何其他设置。

##### 2.参数说明
* **name:** cookie中的变量名
* **requestVarName:** 请求时引用session的变量名。默认 req.session。如果你需要和其他session插件共用。则可以修改这个参数防止冲突
* **autoStart:** 是否自动请求数据库获取session，类似avos-express-cookie-session的fetchUser。非常浪费资源，不推荐使用，建议只有需要的时候手动开始session。
* **cookie:** 参考 cookie-parser 的文档
* **path:** 保存cookie的路径，如果设置为 /aaa，则 / 或 /bbb 中不能获取到这个cookie（进而不能获取session）
* **domain:** 同上，如果设置为 aaa.test.avoscloud.com，则 test.avoscloud.com 或 bbb.test.avoscloud.com 上不能获取
* **signed:** 是否要对cookie进行签名，强烈建议设为默认的true。要注意是这个功能由 cookie-parser 的第一个参数提供（也就是变成了必填），详见文档。
* **secure:** 是否只允许https请求传递cookie，如果设为true，那么普通http请求中将没有session
* **httponly:** 是否允许javascript、flash等脚本访问这个cookie，因为id是随机字符串，通常不会需要js操作，所以建议设为默认的true
* **maxAge:** cookie保存时间，**单位是天，单位是天，单位是天**，因为很重要所以说三遍，超过这个时间的session会自动作废。如果设为0，则用户关闭浏览器后session自动作废。

##### 3.API
### session.sessionStart(newId)
开始一个session，并设置cookie变量为newId，默认会自动生成一个很长的字符串。

### session.sessionDestroy(noDestroyCookie)  
废弃一个session。如果noDestroyCookie设为true，则只是删除所有变量，不真的删除session。

### session.sessionFlush()
保存session到数据库，并自动按需要调用sessionFlushCookie`

### session.sessionFlushCookie(force)
如果cookie里还没有session id，则发送一个setCookie头。
如果force设为true，则无论如何都发送setCookie，这可以顺延当前session的过期时间

### session.raw()
为了防止扰民，session对象重写了inspect和toString。这不影响for-in语句。
但如果开发时想要看看session的具体内容，则可以通过这个函数获取。
**除了开发以外不要用**。

##### 4.实例
```javascript
// 最基本的用法 - 设置一个变量，然后读取它
app.get('/some/path', function (req,res){
	req.session.sessionStart().then(function (){
        console.log(req.session["what ever you want"]); // 首次请求输出undefined，之后输出 exists
        req.session["what ever you want"] = "exists";
        res.send('now it is ' + req.session["what ever you want"]); // 每一次都输出 now it is exists 到浏览器
    }, function (e){ console.error('session加载失败' + e.stack); });
});
```
```javascript
// 设置一个指针类型的数据到session中
app.get('/some/path', function (req,res){
	req.session.sessionStart().then(function (){
	    if(!req.session.user){
            req.session.user = avobject_from_some_where; // 假设是 _User 表查出来的一个用户
        }
        res.send(req.session.user.get('username')); // 第一次输出这个用户的username字段，之后输出undefined。可见虽然能保存pointer，但不会每次都进行查询。如果需要用户信息，需要再调用 req.session.user.fetch() 方法
    }, function (e){ console.error('session加载失败' + e.stack); });
});
```
```javascript
// 请求结束后操作session，只有sessionStart不能再请求结束后使用
app.get('/some/path', function (req,res){
	req.session.sessionStart().then(function (){
        res.send('' + req.session.abc); // 第一次是undefined，之后会输出123，并且数据库会对“123”进行保存
        req.session.abc = 123; // send之后也可以操作session
        req.session.sessionFlush(); // 但你必须调用 sessionFlush 来保存一次数据库，否则*send之后的*修改就丢失了
    }, function (e){ console.error('session加载失败' + e.stack); });
});
```
```javascript
// 初始化前修改session（此时只能添加，最好不要这样做）
app.get('/some/path', function (req,res){
    req.session.abc = 123; // start 之前就操作session
	req.session.sessionStart().then(function (){
        res.send('' + req.session.abc); // 只输出123，从不输出233，但数据库中保存的是“233”
        req.session.abc = 233;
        req.session.sessionFlush(); 
    }, function (e){ console.error('session加载失败' + e.stack); });
});
```
```javascript
app.use('/a', require('lean-g-database-session')('SessionA'), {name: 'cookie-a'}); // 在 /a 目录下用一个session
app.use('/b', require('lean-g-database-session')('SessionB'), {name: 'cookie-b'}); // 在 /b 目录下用另一个互不影响的session
```

## 开发与反馈
当前测试过的环境：
* nodejs >= 0.12
* express >= 4

如果发现不兼容或bug，欢迎随时提出issue

## 限制与注意事项
* 现在还不支持在session中保存AV.Object组成的数组，因为这样很不好，所以暂时都不会支持。
* 这个session和cookie并不“绑定”，通过不同的挂载点和cookie.path，可以实现很多意想不到的功能，但也可能导致混乱
* 由于请求结束时隐含一个flush操作，并且不能知道它是否结束了。所以操作session的行为应该全部放在请求结束前或结束后，而不是两边都有。

## 使用协议

**WTFPL** @ http://www.wtfpl.net/about
