require('dotenv').config();
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, REST, Routes, SlashCommandBuilder, Events, AuditLogEvent 
} = require('discord.js');
const Database = require('better-sqlite3');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildModeration, 
        GatewayIntentBits.GuildInvites, 
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildPresences
    ] 
});

/* ================= DATABASE SETUP ================= */
const db = new Database('paranoia_final.db');
db.prepare(`CREATE TABLE IF NOT EXISTS staff_stats (id TEXT PRIMARY KEY, messages INTEGER DEFAULT 0)`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS linked_users (id TEXT PRIMARY KEY, target_guild TEXT)`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS settings (guild_id TEXT, key TEXT, value TEXT, PRIMARY KEY (guild_id, key))`).run();

/* ================= CONFIGURATION ================= */
const ADMIN_IDS = ['1089621049160769676', '1255899554230833286', '832045642079535106'];

const MAIN_SERVER_ID = '1469784526908690434'; 
const LOG_SERVER_ID = '1464238869909082216'; 
const PD_SERVER_ID = '1470168368421015615'; 

const STAFF_ROLE_ID = '1469831591697317980'; 
const MAIN_AUTO_ROLE = '1469802000513237134'; 
const PD_AUTO_ROLE = '1470171572508819725'; 

const PD_SYNC_ROLE = '1470172344097046620'; 
const MAIN_REWARD_ROLE = '1470171111726514390'; 

const BANNER_URL = 'https://i.imgur.com/MF7dCM9.jpg'; 
const LOG_INVITE = 'https://discord.gg/dPaWqfPmSZ';

const ROLE_MAP = {
    '1469835173989187788': '1469860136695758948',
    '1469787108339220490': '1469860038859427996',
    '1469831591697317980': '1469860002188624055'
};

function logCMD(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

async function sendLog(embed, guildId) {
    try {
        const data = db.prepare("SELECT value FROM settings WHERE guild_id = ? AND key = ?").get(guildId, 'audit_log_channel');
        if (data?.value) {
            const channel = client.channels.cache.get(data.value);
            if (channel) await channel.send({ embeds: [embed.setTimestamp()] }).catch(() => {});
        }
    } catch (e) { logCMD(`❌ Log Error: ${e.message}`); }
}

/* ================= 1. SURVEILLANCE & LOGGING ================= */

client.on(Events.GuildAuditLogEntryCreate, async (auditEntry, guild) => {
    if (guild.id !== MAIN_SERVER_ID) return; 
    try {
        const { action, executorId, targetId, changes } = auditEntry;
        const executor = await client.users.fetch(executorId).catch(() => null);
        if (!executor || executor.bot) return;

        const embed = new EmbedBuilder().setColor('Blue');
        switch (action) {
            case AuditLogEvent.MemberRoleUpdate:
                embed.setTitle('🛡️ Roles Updated').setDescription(`**Target:** <@${targetId}>\n**Mod:** ${executor.tag}`);
                changes.forEach(c => embed.addFields({ name: c.key === '$add' ? '✅ Added' : '❌ Removed', value: `<@&${c.new[0].id}>` }));
                break;
            case AuditLogEvent.MemberKick: embed.setTitle('👢 Kicked').setDescription(`**Mod:** ${executor.tag}`); break;
            case AuditLogEvent.GuildBanAdd: embed.setTitle('🔨 Banned').setDescription(`**Mod:** ${executor.tag}`); break;
            case AuditLogEvent.RoleCreate: embed.setTitle('✨ Role Created').setDescription(`**By:** ${executor.tag}`); break;
            case AuditLogEvent.RoleDelete: embed.setTitle('🔥 Role Deleted').setDescription(`**By:** ${executor.tag}`); break;
            case AuditLogEvent.ChannelCreate: embed.setTitle('📂 Channel Created').setDescription(`**By:** ${executor.tag}`); break;
            case AuditLogEvent.ChannelDelete: embed.setTitle('🗑️ Channel Deleted').setDescription(`**By:** ${executor.tag}`); break;
        }
        if (embed.data.title) sendLog(embed, guild.id);
    } catch (err) { logCMD(`❌ Audit Error: ${err.message}`); }
});

client.on(Events.MessageDelete, async m => {
    if (m.author?.bot) return;
    if (ADMIN_IDS.includes(m.author?.id) && (m.content?.startsWith('!') || m.content?.startsWith('?'))) return; // Ghost Mode
    
    sendLog(new EmbedBuilder().setTitle('🗑️ Message Deleted').setColor('Red')
        .addFields({ name: 'User', value: m.author?.tag || 'Unknown' }, { name: 'Channel', value: `<#${m.channelId}>` }, { name: 'Content', value: m.content || 'Media' }), 
        m.guild.id
    );
});

client.on(Events.MessageUpdate, async (o, n) => {
    if (o.author?.bot || o.content === n.content) return;
    sendLog(new EmbedBuilder().setTitle('📝 Message Edited').setColor('Yellow')
        .addFields({ name: 'User', value: o.author.tag }, { name: 'Before', value: o.content || 'None' }, { name: 'After', value: n.content || 'None' }), 
        o.guild.id
    );
});

/* ================= 2. WELCOMER & AUTO-ROLE (NO DELETION) ================= */

client.on(Events.GuildMemberAdd, async (member) => {
    logCMD(`👤 Join: ${member.user.tag} | Server: ${member.guild.name}`);

    // --- Auto Roles ---
    if (member.guild.id === MAIN_SERVER_ID) await member.roles.add(MAIN_AUTO_ROLE).catch(e => logCMD(`❌ Main Role Error: ${e.message}`));
    
    if (member.guild.id === PD_SERVER_ID) {
        await member.roles.add(PD_AUTO_ROLE).catch(e => logCMD(`❌ PD Role Error: ${e.message}`));
        logCMD(`✅ PD Role 725 applied to ${member.user.tag}`);
    }

    // --- Welcome Message ---
    const data = db.prepare("SELECT value FROM settings WHERE guild_id = ? AND key = ?").get(member.guild.id, 'welcome_channel');
    if (data) {
        const chan = member.guild.channels.cache.get(data.value);
        if (chan) {
            const isPD = member.guild.id === PD_SERVER_ID;
            const embed = new EmbedBuilder()
                .setColor('Red')
                .setImage(BANNER_URL) // IF THIS LINK IS BLOCKED, DISCORD DELETES THE MSG
                .setTitle(isPD ? 'Welcome to Paranoia PD!' : 'Welcome to ParanoiaRP!')
                .setDescription(`Welcome <@${member.id}>!`);
            
            // Send the message - NO DELETE CODE HERE
            chan.send({ content: `Welcome <@${member.id}>!`, embeds: [embed] })
                .then(() => logCMD(`✅ Welcome message sent to #${chan.name}`))
                .catch(() => {
                    // Fallback if image blocked
                    chan.send(`Welcome <@${member.id}> to **${member.guild.name}**!`);
                });
        }
    }
});

/* ================= 3. COMMANDS (NO AUTO-DELETE) ================= */

client.on(Events.MessageCreate, async m => {
    if (m.author.bot || !m.guild) return;
    
    // Staff Stats
    if (m.member.roles.cache.has(STAFF_ROLE_ID)) {
        db.prepare("INSERT INTO staff_stats (id, messages) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET messages = messages + 1").run(m.author.id);
    }
    
    // ?rep Command
    if (m.content === '?rep' && m.member.roles.cache.has(STAFF_ROLE_ID)) {
        await m.delete().catch(() => {});
        return m.channel.send({ embeds: [new EmbedBuilder().setTitle('Ways to Rep').setDescription('.gg/paranioarp , /paranioarp').setColor('Red')] });
    }

    if (!ADMIN_IDS.includes(m.author.id)) return;
    if (!m.content.startsWith('!')) return;

    const args = m.content.slice(1).trim().split(/ +/);
    const cmd = args.shift().toLowerCase();

    try {
        if (cmd === 'ap') {
            await m.delete().catch(() => {});
            const ap = new EmbedBuilder().setTitle('👑 Admin Panel').setColor('Red').setDescription('`!dlogs`, `!welcomer`, `!purgeall`, `!lroles`');
            m.author.send({ embeds: [ap] }).catch(() => {});
        }

        if (cmd === 'welcomer' || cmd === 'dlogs') {
            await m.delete().catch(() => {});
            const key = cmd === 'welcomer' ? 'welcome_channel' : 'audit_log_channel';
            db.prepare("INSERT OR REPLACE INTO settings (guild_id, key, value) VALUES (?, ?, ?)").run(m.guild.id, key, m.channel.id);
            // I REMOVED THE AUTO-DELETE HERE. THIS MESSAGE WILL STAY NOW.
            m.channel.send(`✅ **${cmd}** set for **${m.guild.name}** in this channel.`); 
        }

        if (cmd === 'purgeall') {
            await m.delete().catch(() => {});
            const del = await m.channel.bulkDelete(100, true).catch(() => null);
            if (del) m.channel.send(`✅ Purged ${del.size} messages.`);
        }

        if (cmd === 'lroles') {
            await m.delete().catch(() => {});
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Join Log Discord').setStyle(ButtonStyle.Link).setURL(LOG_INVITE));
            m.channel.send({ embeds: [new EmbedBuilder().setTitle('🛡️ Sync Roles').setImage(BANNER_URL).setColor('Red')], components: [row] });
        }
    } catch (e) { logCMD(`❌ CMD Error: ${e.message}`); }
});

/* ================= 4. SYNC & SLASH ================= */

setInterval(async () => {
    const mainG = client.guilds.cache.get(MAIN_SERVER_ID);
    const pdG = client.guilds.cache.get(PD_SERVER_ID);
    
    // Reward Sync
    if (mainG && pdG) {
        await pdG.members.fetch().catch(() => {});
        pdG.members.cache.forEach(async (m) => {
            if (m.roles.cache.has(PD_SYNC_ROLE)) {
                const mainM = await mainG.members.fetch(m.id).catch(() => null);
                if (mainM && !mainM.roles.cache.has(MAIN_REWARD_ROLE)) {
                    await mainM.roles.add(MAIN_REWARD_ROLE).catch(() => {});
                    logCMD(`🎁 PD Reward: ${m.user.tag}`);
                }
            }
        });
    }

    // Staff Sync Removal
    const logG = client.guilds.cache.get(LOG_SERVER_ID);
    if (mainG && logG) {
        const users = db.prepare("SELECT id FROM linked_users").all();
        for (const row of users) {
            const mS = await mainG.members.fetch(row.id).catch(() => null);
            const mT = await logG.members.fetch(row.id).catch(() => null);
            if (!mT) continue;
            
            if (!mS || !Object.keys(ROLE_MAP).some(r => mS.roles.cache.has(r))) {
                for (const tR of Object.values(ROLE_MAP)) { if (mT.roles.cache.has(tR)) await mT.roles.remove(tR).catch(() => {}); }
                db.prepare("DELETE FROM linked_users WHERE id = ?").run(row.id);
            } else {
                for (const [sR, tR] of Object.entries(ROLE_MAP)) {
                    if (mS.roles.cache.has(sR) && !mT.roles.cache.has(tR)) await mT.roles.add(tR).catch(() => {});
                }
            }
        }
    }
}, 60000);

client.on(Events.InteractionCreate, async i => {
    if (!i.isChatInputCommand() || i.commandName !== 'linkroles') return;
    await i.deferReply({ ephemeral: true }).catch(() => {});
    const src = client.guilds.cache.get(MAIN_SERVER_ID);
    const mem = await src.members.fetch(i.user.id).catch(() => null);
    if (!mem) return i.editReply("❌ Join the main server.");
    let added = false;
    for (const [sR, tR] of Object.entries(ROLE_MAP)) {
        if (mem.roles.cache.has(sR)) { await i.member.roles.add(tR).catch(() => {}); added = true; }
    }
    if (added) {
        db.prepare("INSERT OR REPLACE INTO linked_users (id, target_guild) VALUES (?, ?)").run(i.user.id, LOG_SERVER_ID);
        i.editReply("✅ Synced.");
    } else i.editReply("❌ No roles found.");
});

client.once(Events.ClientReady, async c => {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(Routes.applicationCommands(c.user.id), { body: [new SlashCommandBuilder().setName('linkroles').setDescription('Sync roles')] }).catch(() => {});
    logCMD(`🚀 System Online: ${c.user.tag}`);
});

client.login(process.env.TOKEN);
