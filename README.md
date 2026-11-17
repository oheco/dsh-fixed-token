# @oheco/dsh-fixed-token

仓库：[oheco/dsh-fixed-token](https://github.com/oheco/dsh-fixed-token)。

固定 DSH Web 的启动 token。token 直接存放在插件配置里（profile 的 `cordis.patch.yml`），不依赖环境变量。

- **安装后自动初始化**：第一次加载时插件随机生成一个 token（32 字节，base64url，43 位），立即用于本次启动打印和打开的登录链接，并写入插件配置。之后每次启动都复用这个值。
- **在插件页查看和修改**：侧边栏「插件」→「固定登录 Token」，页面直接显示当前 token 和登录链接，可以复制、修改、重新生成。保存后立即生效，不用重启。
- **不改认证机制**：只替换 DSH 原本每次随机生成的启动 token。登录后仍然写入官方的签名 Cookie（默认 30 天），401、Cookie、HMAC 签名都沿用官方实现。

## 安装

```sh
dsh plugin --profile web add link:/absolute/path/dsh-fixed-token
```

然后重启 `dsh web`。首次启动时终端会出现：

```
dsh web: http://127.0.0.1:<port>/?token=<固定 token>
dsh fixed-token: generated the initial fixed token and saved it to the oheco-fixed-token row of the profile cordis.patch.yml; view or change it on the Plugins page
```

## 配置

插件页修改和手改文件改的是同一份配置：

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
- id: oheco-fixed-token
  name: "@oheco/dsh-fixed-token"
  config:
    token: <16–256 位，只能包含 A-Z a-z 0-9 . _ ~ ->
```

- 手改文件后需要重启 `dsh web`。如果启用了配置热重载，也会自动生效。
- 删掉 `token` 这一行（或设为空字符串），下次启动会重新生成一个。
- 不符合规则的值会被配置校验拒绝，插件页也会禁用保存按钮。

## 停用与卸载

- 临时停用：在插件页关掉这个组件，或在 `cordis.patch.yml` 的这一行加 `disabled: true`。停用后立即恢复 DSH 原生的每次随机 token。
- 卸载：`dsh plugin --profile web remove @oheco/dsh-fixed-token`，并从 profile `package.json` 的 `dsh.profile.bundles` 里移除它。`cordis.patch.yml` 里剩下的 `oheco-fixed-token` 行可以一并删掉。

## 安全提醒

- 固定 token 是一个长期有效、能控制整台机器的凭据。它以明文存放在 profile 的 `cordis.patch.yml` 里（该文件默认权限 600），不要分享这个文件，也不要把它提交到仓库。
- 默认只监听 `127.0.0.1`。如果用 `--host` 暴露到局域网，请保持 token 足够长且随机（直接用「重新生成」即可）。
- 插件自己的输出从不包含 token。终端里唯一出现 token 的地方，是 DSH 自己打印的 `dsh web:` 那一行。

## 实现说明

`@deepseek-ai/dsh-client-connection` 每个进程生成一个随机 token，存在 `BrowserAuth` 实例的 `launchToken` 字段上，并在三处读取：打印的 URL（`authenticatedUrl`）、`GET /?token=` 换 Cookie（`authorizeIndex`）、`GET /connect?token=`（`authorizeConnect`）。插件在 `BrowserAuth` 原型上包装这三个方法，每次调用前写入当前配置的 token。所以：

- 三条路径一起固定；
- Connection 重载后新建的实例同样生效；
- 配置变更在下一次登录时生效；
- 卸载时还原原方法和原随机 token。

启动时会检查这个字段和三个方法是否存在。DSH 升级后如果它们变了，插件会直接报错，而不是悄悄导致登录全部 401。

首次生成的 token 通过 `ctx.settings.update()` 写入 profile 自己的配置层，与官方设置页走同一条持久化路径。参考：[HSR-Firefly/dsh-fixed-login-token](https://github.com/HSR-Firefly/dsh-fixed-login-token)（原型包装、插件页编辑）、[0xshawn/dsh-remote-access](https://github.com/0xshawn/dsh-remote-access)（启动时钉住 token）。

与上面两个插件，以及其他改写 `launchToken` 的插件（例如 dsh-remote-access 的 `launchToken` 配置）不要同时启用。

## 兼容性

在 DSH `0.2.1-rc.5`、Node 24 上验证。

## 测试

测试需要 Node.js 24+ 和已安装的兼容 DSH（本包已在 DSH `0.2.1-rc.5` 上验证）。测试默认从当前 Node 安装目录查找 DSH；如果自动定位失败，在运行 `npm test` 前设置 `DSH_TEST_RUNTIME=/absolute/path/to/installed/dsh`，指向包含 DSH `package.json` 的安装目录。

端到端测试还需要 `PATH` 中可调用的 `dsh`、Bash、Python 3、curl 和常规 Unix 命令。

```sh
npm run check   # 语法与 JSON
npm test        # 单元测试 + 组合测试（真实 Loader/ConfigEditor/Settings/client-connection）
npm run e2e     # 隔离 DSH_HOME + 随机端口跑真实 dsh web，不影响正在使用的 profile
```
