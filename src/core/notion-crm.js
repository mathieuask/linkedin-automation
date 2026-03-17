require('dotenv').config();
const { Client } = require('@notionhq/client');

/**
 * Notion CRM — Interface with your Deals DB
 */
class NotionCRM {
  constructor() {
    this.notion = new Client({ auth: process.env.NOTION_TOKEN });
    this.dealsDatabaseId = process.env.NOTION_DEALS_DB_ID;
  }

  /**
   * Récupère les prospects avec statut "🎯 Lead In"
   * @returns {Promise<Array>}
   */
  async getProspectsToContact() {
    try {
      const response = await this.notion.databases.query({
        database_id: this.dealsDatabaseId,
        filter: {
          property: 'Statut',
          select: { equals: '🎯 Lead In' }
        },
        sorts: [{ property: 'Score', direction: 'descending' }],
        page_size: 50
      });

      return response.results.map(page => this._parseProspectPage(page));
    } catch (error) {
      console.error('❌ Erreur getProspectsToContact:', error.message);
      throw error;
    }
  }

  /**
   * Met à jour le statut d'un prospect
   * @param {string} pageId - ID de la page Notion
   * @param {string} newStatus - Nouveau statut (ex: "📤 Invité", "💬 En conversation")
   * @param {string} notes - Notes optionnelles
   * @returns {Promise<Object>}
   */
  async updateProspectStatus(pageId, newStatus, notes = '') {
    try {
      const properties = {
        'Statut': { select: { name: newStatus } },
        'Dernière action': { date: { start: new Date().toISOString().split('T')[0] } }
      };

      // Ajouter les notes si présentes
      if (notes) {
        // Récupérer les notes existantes
        const page = await this.notion.pages.retrieve({ page_id: pageId });
        const existingNotes = page.properties.Notes?.rich_text[0]?.plain_text || '';
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const newNotes = `${existingNotes}\n[${timestamp}] ${notes}`.trim();
        
        properties['Notes'] = {
          rich_text: [{ text: { content: newNotes.substring(0, 2000) } }] // Limite Notion
        };
      }

      const response = await this.notion.pages.update({
        page_id: pageId,
        properties
      });

      console.log(`✅ Prospect mis à jour : ${newStatus}`);
      return { success: true, pageId, newStatus };
    } catch (error) {
      console.error('❌ Erreur updateProspectStatus:', error.message);
      throw error;
    }
  }

  /**
   * Crée un nouveau prospect dans Notion
   * @param {Object} data - { name, company, title, linkedin, score, status }
   * @returns {Promise<Object>}
   */
  async addProspect({ name, company, title, linkedin, score, status = '🎯 Lead In' }) {
    try {
      const properties = {
        'Nom': { title: [{ text: { content: name } }] },
        'Statut': { select: { name: status } },
        'Score': { number: score || 0 },
        'Dernière action': { date: { start: new Date().toISOString().split('T')[0] } }
      };

      // Champs optionnels
      if (company) {
        properties['Entreprise'] = { rich_text: [{ text: { content: company } }] };
      }
      if (title) {
        properties['Poste'] = { rich_text: [{ text: { content: title } }] };
      }
      if (linkedin) {
        properties['LinkedIn'] = { url: linkedin };
      }

      const response = await this.notion.pages.create({
        parent: { database_id: this.dealsDatabaseId },
        properties
      });

      console.log(`✅ Prospect créé dans Notion : ${name} (${score} pts)`);
      return { success: true, pageId: response.id, name };
    } catch (error) {
      console.error('❌ Erreur addProspect:', error.message);
      throw error;
    }
  }

  /**
   * Cherche un prospect par URL LinkedIn
   * @param {string} linkedinUrl - URL du profil LinkedIn
   * @returns {Promise<Object|null>}
   */
  async getProspectByLinkedIn(linkedinUrl) {
    try {
      // Nettoyer l'URL (enlever params, trailing slash)
      const cleanUrl = linkedinUrl.split('?')[0].replace(/\/$/, '');

      const response = await this.notion.databases.query({
        database_id: this.dealsDatabaseId,
        filter: {
          property: 'LinkedIn',
          url: { contains: cleanUrl.split('/in/')[1] || cleanUrl } // Match sur le username
        },
        page_size: 1
      });

      if (response.results.length > 0) {
        return this._parseProspectPage(response.results[0]);
      }

      return null;
    } catch (error) {
      console.error('❌ Erreur getProspectByLinkedIn:', error.message);
      throw error;
    }
  }

  /**
   * Parse une page Notion en objet prospect
   * @private
   */
  _parseProspectPage(page) {
    return {
      pageId: page.id,
      name: page.properties.Nom?.title[0]?.plain_text || 'Sans nom',
      company: page.properties.Entreprise?.rich_text[0]?.plain_text || '',
      title: page.properties.Poste?.rich_text[0]?.plain_text || '',
      status: page.properties.Statut?.select?.name || '',
      score: page.properties.Score?.number || 0,
      linkedin: page.properties.LinkedIn?.url || '',
      lastAction: page.properties['Dernière action']?.date?.start || '',
      notes: page.properties.Notes?.rich_text[0]?.plain_text || ''
    };
  }
}

module.exports = { NotionCRM };
