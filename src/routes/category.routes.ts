import { Router } from 'express';
import { CategoryController, TagController } from '../controllers/category.controller';

const router = Router();

router.get('/categories', CategoryController.getCategories);
router.get('/categories/:id', CategoryController.getCategory);
router.post('/categories', CategoryController.createCategory);
router.put('/categories/:id', CategoryController.updateCategory);
router.delete('/categories/:id', CategoryController.deleteCategory);

router.get('/tags', TagController.getTags);
router.post('/tags', TagController.createTag);
router.delete('/tags/:id', TagController.deleteTag);

export default router;
