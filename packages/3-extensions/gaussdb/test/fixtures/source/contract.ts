// Emitted into `test/fixtures/generated/` by this package's `emit` script.
// Twin of `test/integration/test/sql-builder/fixtures/contract-no-pgvector.ts`
// (the postgres facade's fixture), authored against the GaussDB packs instead.
import { int4Column, textColumn } from '@internal/adapter-gaussdb/column-types';
import { uuidv4 } from '@internal/ids';
import { defineContract, field, model, rel } from '../../../src/exports/contract-builder';

const UserBase = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    name: field.column(textColumn),
    email: field.column(textColumn),
    invitedById: field.column(int4Column).optional().column('invited_by_id'),
  },
});

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    title: field.column(textColumn),
    userId: field.column(int4Column).column('user_id'),
    views: field.column(int4Column),
  },
  relations: {
    comments: rel.hasMany(() => Comment, { by: 'postId' }),
    author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }),
  },
}).sql({ table: 'posts' });

const Comment = model('Comment', {
  fields: {
    id: field.column(int4Column).id(),
    body: field.column(textColumn),
    postId: field.column(int4Column).column('post_id'),
  },
}).sql({ table: 'comments' });

const Profile = model('Profile', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(int4Column).column('user_id'),
    bio: field.column(textColumn),
  },
}).sql({ table: 'profiles' });

const Article = model('Article', {
  fields: {
    id: field.generated(uuidv4()).id(),
    title: field.column(textColumn),
  },
}).sql({ table: 'articles' });

const User = UserBase.relations({
  invitedUsers: rel.hasMany(() => UserBase, { by: 'invitedById' }),
  invitedBy: rel.belongsTo(UserBase, { from: 'invitedById', to: 'id' }),
  posts: rel.hasMany(() => Post, { by: 'userId' }),
  profile: rel.hasOne(Profile, { by: 'userId' }),
}).sql({ table: 'users' });

export const contract = defineContract({
  models: {
    User,
    Post,
    Comment,
    Profile,
    Article,
  },
});
